import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { FriendshipService } from './friendship.service';
import {
  SendFriendRequestDto,
  GetFriendsQueryDto,
  GetFriendRequestsQueryDto,
} from './dto/friendship.dto';

@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendshipController {
  constructor(private readonly friendshipService: FriendshipService) {}

  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  async sendFriendRequest(
    @CurrentUser('sub') userId: string,
    @Body() dto: SendFriendRequestDto,
  ) {
    return this.friendshipService.sendFriendRequest(userId, dto.receiverId);
  }

  @Put('requests/:requesterId/accept')
  @HttpCode(HttpStatus.OK)
  async acceptFriendRequest(
    @CurrentUser('sub') userId: string,
    @Param('requesterId', ParseUUIDPipe) requesterId: string,
  ) {
    return this.friendshipService.acceptFriendRequest(userId, requesterId);
  }

  @Put('requests/:requesterId/decline')
  @HttpCode(HttpStatus.OK)
  async declineFriendRequest(
    @CurrentUser('sub') userId: string,
    @Param('requesterId', ParseUUIDPipe) requesterId: string,
  ) {
    return this.friendshipService.declineFriendRequest(userId, requesterId);
  }

  @Delete(':friendId')
  @HttpCode(HttpStatus.OK)
  async unfriend(
    @CurrentUser('sub') userId: string,
    @Param('friendId', ParseUUIDPipe) friendId: string,
  ) {
    return this.friendshipService.unfriend(userId, friendId);
  }

  @Post('block/:userId')
  @HttpCode(HttpStatus.OK)
  async blockUser(
    @CurrentUser('sub') userId: string,
    @Param('userId', ParseUUIDPipe) blockedUserId: string,
  ) {
    return this.friendshipService.blockUser(userId, blockedUserId);
  }

  @Delete('block/:userId')
  @HttpCode(HttpStatus.OK)
  async unblockUser(
    @CurrentUser('sub') userId: string,
    @Param('userId', ParseUUIDPipe) blockedUserId: string,
  ) {
    return this.friendshipService.unblockUser(userId, blockedUserId);
  }

  @Get()
  async getFriends(
    @CurrentUser('sub') userId: string,
    @Query() query: GetFriendsQueryDto,
  ) {
    return this.friendshipService.getFriends(
      userId,
      query.page,
      query.limit,
      query.search,
      query.sortBy,
    );
  }

  @Get('requests/pending')
  async getPendingRequests(
    @CurrentUser('sub') userId: string,
    @Query() query: GetFriendRequestsQueryDto,
  ) {
    return this.friendshipService.getPendingRequests(
      userId,
      query.page,
      query.limit,
    );
  }

  @Get('mutual/:userId')
  async getMutualFriends(
    @CurrentUser('sub') userId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.friendshipService.getMutualFriends(userId, targetUserId);
  }

  @Get('suggestions')
  async getFriendSuggestions(
    @CurrentUser('sub') userId: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.friendshipService.getFriendSuggestions(userId, limit);
  }

  @Get('status/:userId')
  async getFriendshipStatus(
    @CurrentUser('sub') userId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.friendshipService.getFriendshipStatus(userId, targetUserId);
  }
}
