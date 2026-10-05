import { routeByAction } from "./_lib/router.js";
import channels from "./_lib/routes/inbox/channels.js";
import conversations from "./_lib/routes/inbox/conversations.js";
import messages from "./_lib/routes/inbox/messages.js";
import send from "./_lib/routes/inbox/send.js";

/** Una sola función para /api/inbox/* (channels, conversations, messages, send). */
export default routeByAction("inbox", { channels, conversations, messages, send });
