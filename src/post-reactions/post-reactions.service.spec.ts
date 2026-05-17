import { Test, TestingModule } from '@nestjs/testing';
import { PostReactionsService } from './post-reactions.service';

describe('PostReactionsService', () => {
  let service: PostReactionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PostReactionsService],
    }).compile();

    service = module.get<PostReactionsService>(PostReactionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
