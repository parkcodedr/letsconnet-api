export interface ProfileDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  bio: string | null;
  followersCount: number;
  followingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserResponseDto {
  id: string;
  email: string;
  role: string;
  isVerified: boolean;
  isDisabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile: ProfileDto;
}

export interface AuthUserResponseDto {
  id: string;
  email: string;
  role: string;
  isVerified: boolean;
  profile: {
    username: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
}
