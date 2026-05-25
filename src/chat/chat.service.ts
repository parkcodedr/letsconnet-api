import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from 'src/database/database.service';
import { Redis as RedisClient } from 'ioredis';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';
import { StorageProvider } from 'src/common/storage/storage.interface';
import { ChatMediaJobData } from './chat-media.processor';
import {
  CreateDirectChatDto,
  CreateGroupChatDto,
  SendMessageDto,
  GetMessagesDto,
  DeleteType,
  ForwardMessageDto,
} from './dto/chat.dto';

@Injectable()
export class ChatService {
  private readonly MESSAGES_CACHE_TTL = 60;
  private readonly CHATS_CACHE_TTL = 300;

  constructor(
    private db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @InjectQueue('chat-media-processing')
    private readonly chatMediaQueue: Queue,
  ) {}

  // ---------- Chat Management ----------
  async createDirectChat(userId: string, dto: CreateDirectChatDto) {
    if (userId === dto.participantId)
      throw new BadRequestException('Cannot create chat with yourself');
    const participant = await this.db.user.findUnique({
      where: { id: dto.participantId },
    });
    if (!participant) throw new NotFoundException('User not found');

    const existing = await this.db.chat.findFirst({
      where: {
        isGroup: false,
        participants: {
          every: { userId: { in: [userId, dto.participantId] } },
        },
      },
      include: {
        participants: {
          include: { user: { select: { id: true, profile: true } } },
        },
      },
    });
    if (existing) return this.formatChat(existing, userId);

    const chat = await this.db.chat.create({
      data: {
        isGroup: false,
        participants: { create: [{ userId }, { userId: dto.participantId }] },
      },
      include: {
        participants: {
          include: { user: { select: { id: true, profile: true } } },
        },
      },
    });
    await this.invalidateUserChatsCache(userId);
    return this.formatChat(chat, userId);
  }

  async createGroupChat(userId: string, dto: CreateGroupChatDto) {
    const uniqueParticipants = [...new Set([userId, ...dto.participantIds])];
    if (uniqueParticipants.length < 2)
      throw new BadRequestException('Group needs at least 2 members');
    const users = await this.db.user.findMany({
      where: { id: { in: uniqueParticipants } },
    });
    if (users.length !== uniqueParticipants.length)
      throw new NotFoundException('Some participants not found');

    const chat = await this.db.chat.create({
      data: {
        isGroup: true,
        title: dto.title,
        avatarUrl: dto.avatarUrl,
        participants: {
          create: uniqueParticipants.map((uid) => ({ userId: uid })),
        },
      },
      include: {
        participants: {
          include: { user: { select: { id: true, profile: true } } },
        },
      },
    });
    await this.invalidateUserChatsCache(userId);
    return this.formatChat(chat, userId);
  }

  async getUserChats(userId: string, page = 1, limit = 20) {
    const cacheKey = `user_chats:${userId}:${page}:${limit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const skip = (page - 1) * limit;
    const participants = await this.db.chatParticipant.findMany({
      where: { userId },
      include: {
        chat: {
          include: {
            participants: {
              include: { user: { select: { id: true, profile: true } } },
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: {
                sender: { select: { id: true, profile: true } },
                media: true,
              },
            },
          },
        },
      },
      orderBy: { chat: { updatedAt: 'desc' } },
      skip,
      take: limit,
    });
    const chats = participants.map((p) => this.formatChat(p.chat, userId));
    const total = await this.db.chatParticipant.count({ where: { userId } });
    const result = { data: chats, meta: { total, page, limit } };
    await this.redis.setex(
      cacheKey,
      this.CHATS_CACHE_TTL,
      JSON.stringify(result),
    );
    return result;
  }

  async getChatById(chatId: string, userId: string) {
    const chat = await this.db.chat.findFirst({
      where: { id: chatId, participants: { some: { userId } } },
      include: {
        participants: {
          include: { user: { select: { id: true, profile: true } } },
        },
      },
    });
    if (!chat) throw new NotFoundException('Chat not found');
    return this.formatChat(chat, userId);
  }

  
  async sendMessage(
    userId: string,
    chatId: string,
    dto: SendMessageDto,
    files?: Express.Multer.File[],
  ) {
    const chat = await this.db.chat.findFirst({
      where: { id: chatId, participants: { some: { userId } } },
    });
    if (!chat) throw new NotFoundException('Chat not found');

    const message = await this.db.message.create({
      data: {
        chatId,
        senderId: userId,
        type: dto.type,
        content: dto.content,
        replyToId: dto.replyToId,
      },
      include: { sender: { select: { id: true, profile: true } } },
    });

    if (files?.length) {
      await Promise.all(
        files.map(async (file, idx) => {
          const mediaType = this.getMediaTypeFromMime(file.mimetype);
          const media = await this.db.messageMedia.create({
            data: {
              messageId: message.id,
              type: mediaType,
              order: idx,
            },
          });
          await this.chatMediaQueue.add('process-chat-media', {
            messageMediaId: media.id,
            localPath: file.path,
            mimeType: file.mimetype,
            messageId: message.id,
            chatId,
            userId,
            order: idx,
          } as ChatMediaJobData);
        }),
      );
    }

    await this.db.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date(), lastMessageId: message.id },
    });

    await this.invalidateChatMessagesCache(chatId);
    const participantIds = await this.getChatParticipantIds(chatId);
    await this.invalidateUserChatsCacheBulk(participantIds);

    return message;
  }

  async getMessages(userId: string, chatId: string, query: GetMessagesDto) {
    const { page = 1, limit = 50 } = query;
    const cacheKey = `chat_messages:${chatId}:${userId}:${page}:${limit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const participant = await this.db.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!participant) throw new ForbiddenException('Access denied');

    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      this.db.message.findMany({
        where: {
          chatId,
          NOT: {
            deletedFor: { has: userId },
          },
        },
        include: {
          sender: { select: { id: true, profile: true } },
          media: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.message.count({ where: { chatId } }),
    ]);

    const result = {
      data: messages.reverse(),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
    await this.redis.setex(
      cacheKey,
      this.MESSAGES_CACHE_TTL,
      JSON.stringify(result),
    );
    return result;
  }

  async deleteMessage(
    userId: string,
    messageId: string,
    deleteType: DeleteType,
  ) {
    const message = await this.db.message.findUnique({
      where: { id: messageId },
      include: { chat: true },
    });
    if (!message) throw new NotFoundException('Message not found');

    const isParticipant = await this.db.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: message.chatId, userId } },
    });
    if (!isParticipant) throw new ForbiddenException('Access denied');

    if (deleteType === DeleteType.FOR_ME) {
      await this.db.message.update({
        where: { id: messageId },
        data: { deletedFor: { push: userId } },
      });
    } else {
      const isSender = message.senderId === userId;
      const isRecent = Date.now() - message.createdAt.getTime() < 5 * 60 * 1000;
      if (!isSender || !isRecent)
        throw new ForbiddenException('Cannot delete this message for everyone');
      await this.db.message.delete({ where: { id: messageId } });
    }
    await this.invalidateChatMessagesCache(message.chatId);
    return { success: true };
  }

  async forwardMessage(userId: string, dto: ForwardMessageDto) {
    const original = await this.db.message.findUnique({
      where: { id: dto.messageId },
      include: { media: true },
    });
    if (!original) throw new NotFoundException('Message not found');

    const targetChats = await this.db.chat.findMany({
      where: {
        id: { in: dto.targetChatIds },
        participants: { some: { userId } },
      },
    });
    if (targetChats.length !== dto.targetChatIds.length)
      throw new BadRequestException('Some chats not accessible');

    const forwardedMessages: any[] = [];
    for (const chat of targetChats) {
      const newMsg = await this.db.message.create({
        data: {
          chatId: chat.id,
          senderId: userId,
          type: original.type,
          content: dto.caption || original.content,
          isForwarded: true,
        },
      });
      for (const media of original.media) {
        await this.db.messageMedia.create({
          data: {
            messageId: newMsg.id,
            type: media.type,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
            width: media.width,
            height: media.height,
            duration: media.duration,
            size: media.size,
            publicId: media.publicId,
            order: media.order,
          },
        });
      }
      await this.db.chat.update({
        where: { id: chat.id },
        data: { updatedAt: new Date(), lastMessageId: newMsg.id },
      });
      await this.invalidateChatMessagesCache(chat.id);
      forwardedMessages.push(newMsg);
    }
    return forwardedMessages;
  }

  async clearChat(userId: string, chatId: string) {
    const participant = await this.db.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!participant) throw new ForbiddenException('Access denied');
    const messages = await this.db.message.findMany({
      where: { chatId },
      select: { id: true },
    });
    for (const msg of messages) {
      await this.db.message.update({
        where: { id: msg.id },
        data: { deletedFor: { push: userId } },
      });
    }
    await this.invalidateChatMessagesCache(chatId);
    return { success: true };
  }

  async markMessagesAsRead(
    userId: string,
    chatId: string,
    upToMessageId?: string,
  ) {
    const participant = await this.db.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!participant) throw new ForbiddenException('Access denied');
    let readUpToDate = new Date();
    if (upToMessageId) {
      const msg = await this.db.message.findUnique({
        where: { id: upToMessageId },
        select: { createdAt: true },
      });
      if (!msg) throw new NotFoundException('Message not found');
      readUpToDate = msg.createdAt;
    }
    await this.db.chatParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: readUpToDate },
    });
    return { success: true };
  }

  async getUnreadCounts(userId: string) {
    const participants = await this.db.chatParticipant.findMany({
      where: { userId },
      include: {
        chat: {
          include: {
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    const counts: { chatId: string; unreadCount: number }[] = [];
    for (const p of participants) {
      const lastMsg = p.chat.messages[0];
      if (!lastMsg) continue;
      const unread = await this.db.message.count({
        where: {
          chatId: p.chatId,
          createdAt: { gt: p.lastReadAt || new Date(0) },
          senderId: { not: userId },
        },
      });
      counts.push({ chatId: p.chatId, unreadCount: unread });
    }
    return counts;
  }

  async searchMessages(userId: string, chatId: string | null, query: string) {
    const where: any = { content: { contains: query, mode: 'insensitive' } };
    if (chatId) {
      const participant = await this.db.chatParticipant.findUnique({
        where: { chatId_userId: { chatId, userId } },
      });
      if (!participant) throw new ForbiddenException('Access denied');
      where.chatId = chatId;
    } else {
      const userChatIds = (
        await this.db.chatParticipant.findMany({
          where: { userId },
          select: { chatId: true },
        })
      ).map((p) => p.chatId);
      where.chatId = { in: userChatIds };
    }
    return this.db.message.findMany({
      where,
      include: { sender: { select: { id: true, profile: true } }, media: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ---------- Presence ----------
  async setUserOnline(userId: string) {
    await this.redis.set(`user_presence:${userId}`, 'online', 'EX', 60);
  }
  async setUserOffline(userId: string) {
    await this.redis.del(`user_presence:${userId}`);
  }
  async getUserPresence(userId: string): Promise<'online' | 'offline'> {
    const status = await this.redis.get(`user_presence:${userId}`);
    return status === 'online' ? 'online' : 'offline';
  }
  async getChatPresence(userId: string, chatId: string) {
    const participants = await this.db.chatParticipant.findMany({
      where: { chatId },
      select: { userId: true },
    });
    const presences: { userId: string; status: 'online' | 'offline' }[] = [];
    for (const p of participants) {
      if (p.userId !== userId) {
        presences.push({
          userId: p.userId,
          status: await this.getUserPresence(p.userId),
        });
      }
    }
    return presences;
  }

  // ---------- Helpers ----------
  private formatChat(chat: any, currentUserId: string) {
    const otherParticipants = chat.participants
      .filter((p: any) => p.userId !== currentUserId)
      .map((p: any) => p.user);
    const lastMessage = chat.messages?.[0] || null;
    return {
      id: chat.id,
      isGroup: chat.isGroup,
      title:
        chat.title ||
        (chat.isGroup
          ? null
          : otherParticipants[0]?.profile?.firstName +
            ' ' +
            otherParticipants[0]?.profile?.lastName),
      avatarUrl:
        chat.avatarUrl ||
        (chat.isGroup ? null : otherParticipants[0]?.profile?.avatarUrl),
      participants: chat.participants.map((p: any) => p.user),
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            content:
              lastMessage.content ||
              (lastMessage.media?.length ? `📎 ${lastMessage.type}` : null),
            type: lastMessage.type,
            sender: lastMessage.sender,
            createdAt: lastMessage.createdAt,
          }
        : null,
      updatedAt: chat.updatedAt,
    };
  }

  // Map MIME type to Prisma MediaType enum (IMAGE, VIDEO, AUDIO, FILE) – no VOICE
  private getMediaTypeFromMime(mime: string): 'IMAGE' | 'VIDEO' | 'AUDIO' {
    if (mime.startsWith('image/')) return 'IMAGE';
    if (mime.startsWith('video/')) return 'VIDEO';
    if (mime.startsWith('audio/')) return 'AUDIO';
    return 'IMAGE';
  }

  private async invalidateUserChatsCache(userId: string) {
    const keys = await this.redis.keys(`user_chats:${userId}:*`);
    if (keys.length) await this.redis.del(...keys);
  }
  private async invalidateUserChatsCacheBulk(userIds: string[]) {
    await Promise.all(userIds.map((id) => this.invalidateUserChatsCache(id)));
  }
  private async invalidateChatMessagesCache(chatId: string) {
    const keys = await this.redis.keys(`chat_messages:${chatId}:*`);
    if (keys.length) await this.redis.del(...keys);
  }

  async getChatParticipantIds(chatId: string): Promise<string[]> {
    const participants = await this.db.chatParticipant.findMany({
      where: { chatId },
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }
  async verifyParticipant(chatId: string, userId: string): Promise<boolean> {
    const participant = await this.db.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    return !!participant;
  }
}
