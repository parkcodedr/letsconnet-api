import { Profile, User } from 'generated/prisma/client';
import {
  UserResponseDto,
  AuthUserResponseDto,
  ProfileDto,
} from '../dto/user-response.dto';

type SafeUser = Omit<User, 'passwordHash' | 'refreshTokenHash'>;

export class UserResource {
  static toProfile(profile: Profile): ProfileDto {
    return {
      id: profile.id,
      username: profile.username,
      firstName: profile.firstName,
      lastName: profile.lastName,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      followersCount: profile.followersCount,
      followingCount: profile.followingCount,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  static toFullUser(
    user: SafeUser & { profile: Profile | null },
  ): UserResponseDto | null {
    if (!user.profile) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
      isDisabled: user.isDisabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      profile: this.toProfile(user.profile),
    };
  }

  static forAuth(
    user: SafeUser & { profile: Profile | null },
  ): AuthUserResponseDto | null {
    if (!user.profile) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
      profile: {
        username: user.profile.username,
        firstName: user.profile.firstName,
        lastName: user.profile.lastName,
        avatarUrl: user.profile.avatarUrl,
      },
    };
  }
}
