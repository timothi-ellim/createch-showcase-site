import type { APIContext } from 'astro';
import { event, projects } from '../../../data/catalogue';
import type { PublicProject } from '../../../lib/content-schema';
import { socialImage } from '../../../lib/social-image';
export const prerender = true;
export function getStaticPaths() {
  return projects.map((project) => ({
    params: { slug: project.slug },
    props: { project },
  }));
}
export async function GET({ props }: APIContext) {
  return new Response(
    new Uint8Array(await socialImage(event, props.project as PublicProject)),
    {
      headers: { 'Content-Type': 'image/png' },
    },
  );
}
