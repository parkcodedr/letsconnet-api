import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';
import { StorageProvider } from 'src/common/storage/storage.interface';
import { UpdateProfileDto } from './dto/update-profile.dto';
import * as fs from 'fs/promises';

@Injectable()
export class UsersService {
  constructor(
    private db: DatabaseService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async getCurrentUser(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, refreshTokenHash, ...safeUser } = user;
    return safeUser;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updatedProfile = await this.db.profile.update({
      where: { userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        bio: dto.bio,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        gender: dto.gender,
        website: dto.website,
        city: dto.city,
        state: dto.state,
        country: dto.country,
      },
    });

    return updatedProfile;
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.profile?.avatarUrl) {
    }

    const uploaded = await this.storage.uploadFile(file.path, {
      userId,
      resourceType: 'image',
      customPublicId: `avatar_${userId}_${Date.now()}`,
      isThumbnail: false,
    });

    const updatedProfile = await this.db.profile.update({
      where: { userId },
      data: { avatarUrl: uploaded.url },
    });
    await fs.unlink(file.path).catch(() => {});

    return { ...updatedProfile, avatarUrl: uploaded.url };
  }
}
