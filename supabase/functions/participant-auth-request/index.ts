import { hostedAuth } from '../_shared/auth-runtime.ts';
Deno.serve(hostedAuth('request'));
