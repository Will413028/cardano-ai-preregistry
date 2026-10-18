import { create_relay } from '../../src/relay.ts';

/**
 * Cloudflare Pages Function at `/api/cardano` (D17), the same handler as the Vite servers. Its cache lives per isolate.
 * Deploying it is the repo owner's step; the handler is tested under Vite only.
 */
const relay = create_relay((...args) => fetch(...args));
export const onRequest = ({ request }: { request: Request }): Promise<Response> => relay(request);
