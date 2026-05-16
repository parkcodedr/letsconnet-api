import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from 'src/database/database.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { jwtConstants } from './constants';
import { hashData, verifyHash } from './utils/hash';
import { User, UserSession } from 'generated/prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async register(
    dto: RegisterDto,
    meta?: {
      ipAddress?: string;
      userAgent?: string;
      deviceName?: string;
    },
  ) {
    const existingEmail = await this.database.user.findUnique({
      where: {
        email: dto.email.toLowerCase(),
      },
    });

    if (existingEmail) {
      throw new BadRequestException('Email already exists');
    }

    const username = await this.generateUniqueUsername(
      dto.firstName,
      dto.lastName,
    );

    const passwordHash = await hashData(dto.password);

    const user = await this.database.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,

        profile: {
          create: {
            username,

            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),

            gender: dto.gender,
            phoneNumber: dto.phoneNumber,

            dateOfBirth: new Date(dto.dateOfBirth),
          },
        },
      },
      include: {
        profile: true,
      },
    });

    const tokens = await this.generateTokens(user);

    await this.createSession({
      userId: user.id,
      refreshToken: tokens.refreshToken,

      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      deviceName: meta?.deviceName,
    });

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  async login(
    dto: LoginDto,
    meta?: {
      ipAddress?: string;
      userAgent?: string;
      deviceName?: string;
    },
  ) {
    const user = await this.database.user.findUnique({
      where: {
        email: dto.email.toLowerCase(),
      },
      include: {
        profile: true,
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isDisabled) {
      throw new ForbiddenException('Account disabled');
    }

    const passwordMatches = await verifyHash(user.passwordHash, dto.password);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user);

    await this.createSession({
      userId: user.id,
      refreshToken: tokens.refreshToken,

      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      deviceName: meta?.deviceName,
    });

    await this.database.user.update({
      where: {
        id: user.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: jwtConstants.refreshSecret,
      });

      const user = await this.database.user.findUnique({
        where: {
          id: payload.sub,
        },
        include: {
          profile: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException();
      }

      if (user.tokenVersion !== payload.tokenVersion) {
        throw new UnauthorizedException('Session expired');
      }

      const sessions = await this.database.userSession.findMany({
        where: {
          userId: user.id,
          isRevoked: false,
          expiresAt: {
            gt: new Date(),
          },
        },
      });

      let matchedSession: UserSession | null = null;

      for (const session of sessions) {
        const matches = await verifyHash(
          session.refreshTokenHash,
          refreshToken,
        );

        if (matches) {
          matchedSession = session;
          break;
        }
      }

      if (!matchedSession) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = await this.generateTokens(user);

      const newRefreshHash = await hashData(tokens.refreshToken);

      await this.database.userSession.update({
        where: {
          id: matchedSession.id,
        },
        data: {
          refreshTokenHash: newRefreshHash,
        },
      });

      return {
        user: this.sanitizeUser(user),
        tokens,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken: string) {
    const sessions = await this.database.userSession.findMany({
      where: {
        userId,
        isRevoked: false,
      },
    });

    for (const session of sessions) {
      const matches = await verifyHash(session.refreshTokenHash, refreshToken);

      if (matches) {
        await this.database.userSession.update({
          where: {
            id: session.id,
          },
          data: {
            isRevoked: true,
          },
        });

        break;
      }
    }

    return {
      success: true,
    };
  }

  async logoutAll(userId: string) {
    await this.database.user.update({
      where: {
        id: userId,
      },
      data: {
        tokenVersion: {
          increment: 1,
        },
      },
    });

    await this.database.userSession.updateMany({
      where: {
        userId,
      },
      data: {
        isRevoked: true,
      },
    });

    return {
      success: true,
    };
  }

  private async generateTokens(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: jwtConstants.accessSecret,
        expiresIn: '2h',
      }),

      this.jwtService.signAsync(payload, {
        secret: jwtConstants.refreshSecret,
        expiresIn: '30d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  private async createSession(params: {
    userId: string;
    refreshToken: string;

    ipAddress?: string;
    userAgent?: string;
    deviceName?: string;
  }) {
    const refreshTokenHash = await hashData(params.refreshToken);

    await this.database.userSession.create({
      data: {
        userId: params.userId,

        refreshTokenHash,

        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        deviceName: params.deviceName,

        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      },
    });
  }

  private async generateUniqueUsername(firstName: string, lastName: string) {
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanLast = lastName.toLowerCase().replace(/[^a-z0-9]/g, '');

    const baseUsername = `${cleanFirst}${cleanLast}`;

    let username = baseUsername;

    let exists = await this.database.profile.findUnique({
      where: {
        username,
      },
    });

    while (exists) {
      const random = Math.floor(1000 + Math.random() * 9000);

      username = `${baseUsername}${random}`;

      exists = await this.database.profile.findUnique({
        where: {
          username,
        },
      });
    }

    return username;
  }

  private sanitizeUser(user: any) {
    delete user.passwordHash;
    delete user.refreshTokenHash;
    delete user.emailVerifyToken;
    delete user.passwordResetToken;
    delete user.tokenVersion;

    return user;
  }
}
