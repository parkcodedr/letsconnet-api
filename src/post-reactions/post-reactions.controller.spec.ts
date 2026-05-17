import { Test, TestingModule } from '@nestjs/testing';
import { PostReactionsController } from './post-reactions.controller';

describe('PostReactionsController', () => {
  let controller: PostReactionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostReactionsController],
    }).compile();

    controller = module.get<PostReactionsController>(PostReactionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
