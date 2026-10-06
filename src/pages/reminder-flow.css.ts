import styles from '../styles/event-actions.css?raw';
export const prerender = true;
export function GET() {
  return new Response(
    `*{box-sizing:border-box}body{margin:0;background:#2410d7;font-family:Arial,Helvetica,sans-serif;line-height:1.6}a{color:inherit;text-underline-offset:4px}button,input{font:inherit}button{cursor:pointer}p,h1,h2{margin-top:0}h1,h2{line-height:1.1;letter-spacing:-.045em}.wrap{max-width:900px;margin:40px auto;padding:0 20px}.reminder-page{margin-inline:20px}.reminder-page h1{font-size:clamp(2rem,6vw,3rem)}.flow-nav{color:white;margin:24px;display:block}.reminder-submit{max-width:440px}.flow-action{margin-block:24px}.flow-links{display:flex;gap:24px;flex-wrap:wrap}.flow-links a{padding-block:12px}${styles}`,
    { headers: { 'Content-Type': 'text/css; charset=utf-8' } },
  );
}
