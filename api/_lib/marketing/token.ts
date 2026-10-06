/** Token del link de baja (formato y firma en shared/marketingCrypto.ts). */
import { menv } from "./env.js";
import { signUnsubTokenWith, verifyUnsubTokenWith } from "../../../shared/marketingCrypto.js";

export const signUnsubToken = (recipientId: string) => signUnsubTokenWith(recipientId, menv("MARKETING_UNSUB_SECRET"));
export const verifyUnsubToken = (token: string) => verifyUnsubTokenWith(token, menv("MARKETING_UNSUB_SECRET"));
