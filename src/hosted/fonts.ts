import { fontData } from './font-data.js';
export const fontStyles = `
@font-face{font-family:"Geist Sans";font-style:normal;font-weight:100 900;font-display:swap;src:url('/fonts/geist-sans-1.7.2.woff2') format('woff2')}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url('/fonts/geist-mono-1.7.2.woff2') format('woff2')}
`;
export function fontResponse(request:Request):Response|null {
 const data=fontData[new URL(request.url).pathname];
 if(!data)return null;
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
 return new Response(request.method==='HEAD'?null:Buffer.from(data,'base64'),{headers:{'Content-Type':'font/woff2','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
}
