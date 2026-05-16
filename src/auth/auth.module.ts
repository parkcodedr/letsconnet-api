import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { DatabaseService } from 'src/database/database.service';

@Module({
  imports: [JwtModule.register({})],

  providers: [AuthService, JwtStrategy, DatabaseService],

  controllers: [AuthController],

  exports: [AuthService],
})
export class AuthModule {}
