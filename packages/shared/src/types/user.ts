export interface IUser {
  _id: string;
  telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  updatedAt: string;
}
