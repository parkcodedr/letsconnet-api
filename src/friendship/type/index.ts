import { FRIEND_REQUEST_ACTION } from 'src/common/constant/friendship';

export type FriendRequestAction =
  (typeof FRIEND_REQUEST_ACTION)[keyof typeof FRIEND_REQUEST_ACTION];
