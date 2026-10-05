import { z } from 'zod';

const callbackSchema = z.object({
  sessionId: z.string().min(1).max(200),
  serviceCode: z.string().min(1).max(50),
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  text: z.string().max(1024),
});

/** A stateless demo: AT sends the complete accumulated input on every callback. */
export function handleUssd(fields: Record<string, string>): string {
  const callback = callbackSchema.safeParse(fields);
  if (!callback.success) return 'END Invalid session request.';
  const { text } = callback.data;
  if (text === '') return 'CON Welcome to the unofficial demo\n1. About\n2. Help';
  if (text === '1') return 'CON This is a sample USSD application\n1. Finish';
  if (text === '1*1') return 'END Thanks for trying the demo.';
  if (text === '2') return 'END Contact the application owner for help.';
  return 'END Invalid selection. Please dial again.';
}
