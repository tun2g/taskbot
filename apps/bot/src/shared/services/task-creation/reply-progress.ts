import { BotContext } from 'src/bot/interface/context';
import logger from 'src/shared/logger/logger';
import { SendExtra } from 'src/shared/services/task-creation/types';
import { Message } from 'telegraf/types';

export const PROGRESS_DELAY_MS = 1500;

/**
 * Keeps each request to ONE bot message: posts `text` only if the work takes longer than
 * 1.5s, then `finish()` edits that same message into the final answer (or posts it).
 * `delayMs: null` = no progress message at all (finish just posts).
 */
export class ReplyProgress {
  private timer: NodeJS.Timeout | null;
  private pending: Promise<Message.TextMessage | null> | null = null;

  constructor(
    private ctx: BotContext,
    text: string,
    delayMs: number | null = PROGRESS_DELAY_MS,
  ) {
    this.timer =
      delayMs === null
        ? null
        : setTimeout(() => {
            this.timer = null;
            this.pending = ctx.reply(text).catch((error) => {
              logger.warn(`Could not post progress message: ${error}`);
              return null;
            });
          }, delayMs);
  }

  /** Stops the pending progress message and removes it if it was already posted. */
  async cancel(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const progress = this.pending ? await this.pending : null;
    this.pending = null;
    if (progress) await this.ctx.telegram.deleteMessage(this.ctx.chat!.id, progress.message_id).catch(() => undefined);
  }

  async finish(text: string, extra: SendExtra = {}): Promise<number | undefined> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const progress = this.pending ? await this.pending : null;
    const chatId = this.ctx.chat!.id;

    if (progress) {
      try {
        await this.sendWithParseFallback(extra, (e) =>
          this.ctx.telegram.editMessageText(chatId, progress.message_id, undefined, text, e as never),
        );
        return progress.message_id;
      } catch (error) {
        logger.warn(`Could not edit progress message, posting a new one: ${error}`);
        await this.ctx.telegram.deleteMessage(chatId, progress.message_id).catch(() => undefined);
      }
    }
    const sent = await this.sendWithParseFallback(extra, (e) => this.ctx.reply(text, e));
    return (sent as Message.TextMessage | undefined)?.message_id;
  }

  // A formatting mistake must never cost the user their reply: retry without parse_mode.
  private async sendWithParseFallback<R>(extra: SendExtra, send: (extra: SendExtra) => Promise<R>): Promise<R> {
    try {
      return await send(extra);
    } catch (error) {
      if (extra?.parse_mode && String(error).includes("can't parse entities")) {
        logger.warn(`Message formatting rejected, resending as plain text: ${error}`);
        const { parse_mode: _ignored, ...plain } = extra;
        return await send(plain);
      }
      throw error;
    }
  }
}
