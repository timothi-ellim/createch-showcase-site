import { motionDuration as d, motionEase } from './tokens';
export const prerender = true;
export function GET() {
  return new Response(
    `:root{--motion-micro:${d.micro}ms;--motion-ui:${d.ui}ms;--motion-ease:cubic-bezier(${motionEase.direct.join(',')})}
.code-pixels{position:absolute;inset:0;pointer-events:none;overflow:hidden}.pixel-word{position:relative}.code-pixel{position:absolute;width:.07em;height:.07em;background:currentColor;right:0;top:16%}.code-pixel:nth-child(2){right:.14em;top:44%}.code-pixel:nth-child(3){right:.28em;top:72%}
.site-header nav a{position:relative}.site-header nav a::after{content:'';position:absolute;left:0;right:0;bottom:-.3rem;height:2px;background:currentColor;transform:scaleX(0);transform-origin:left}.site-header nav a[aria-current=page]::after{transform:scaleX(1)}
@media(prefers-reduced-motion:no-preference){html:not([data-motion-level=off]) .site-header nav a::after{transition:transform var(--motion-micro) var(--motion-ease)}html:not([data-motion-level=off]) :is(.button,.filters button){transition:background-color var(--motion-micro),border-color var(--motion-micro)}html:not([data-motion-level=off]) details[open] summary{border-bottom-color:currentColor}
@media(hover:hover) and (pointer:fine){html:not([data-motion-level=off]) .project-media img{transition:transform var(--motion-ui) var(--motion-ease)}html:not([data-motion-level=off]) .project-card:hover .project-media img{transform:scale(1.015)}html[data-motion-level=full] .theme-tile .tile-top{transition:border-color var(--motion-ui),transform var(--motion-ui)}html[data-motion-level=full] .theme-tile:hover .tile-top{border-color:var(--ct-lemon)}html[data-motion-level=full] .theme-tile.image:hover .tile-top{transform:scaleX(.98)}html[data-motion-level=full] .theme-tile.world:hover .tile-top{transform:scaleX(1.015)}html[data-motion-level=full] .theme-tile.relation:hover .tile-top{transform:translateX(3px)}html:not([data-motion-level=off]) .site-header nav a:hover::after{transform:scaleX(1)}}}
html[data-motion-level=off] *,html[data-motion-level=off] *::before,html[data-motion-level=off] *::after{animation:none!important;transition:none!important}
@media(prefers-reduced-motion:no-preference){html:not([data-motion-level=off]) .site-header nav a:focus-visible::after{transform:scaleX(1)}html[data-motion-level=full] .theme-tile:focus-visible .tile-top{transition:border-color var(--motion-ui),transform var(--motion-ui);border-color:var(--ct-lemon)}html[data-motion-level=full] .theme-tile.image:focus-visible .tile-top{transform:scaleX(.98)}html[data-motion-level=full] .theme-tile.world:focus-visible .tile-top{transform:scaleX(1.015)}html[data-motion-level=full] .theme-tile.relation:focus-visible .tile-top{transform:translateX(3px)}}
@media(prefers-reduced-motion:reduce){.code-pixels{display:none}*{scroll-behavior:auto!important}}
@media(forced-colors:active){.code-pixels{display:none}.site-header nav a::after{background:LinkText}}
@media print{.code-pixels{display:none}}
`,
    { headers: { 'Content-Type': 'text/css' } },
  );
}
