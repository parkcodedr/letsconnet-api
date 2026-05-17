export const REACTION_TYPES = [
  'LIKE',
  'LOVE',
  'HAHA',
  'WOW',
  'SAD',
  'ANGRY',
] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

export interface ReactionCount {
  type: ReactionType;
  count: number;
}

export interface ReactionSummary {
  total: number;
  reactions: ReactionCount[];
  userReaction?: ReactionType;
}
