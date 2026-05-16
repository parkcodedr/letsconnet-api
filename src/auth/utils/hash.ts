import * as argon2 from 'argon2';

export async function hashData(data: string) {
  return argon2.hash(data, {
    type: argon2.argon2id,
  });
}

export async function verifyHash(hash: string, plain: string) {
  return argon2.verify(hash, plain);
}
