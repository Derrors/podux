declare module "virtual:iconify-icons" {
  import type { IconifyJSON } from "@iconify/react/offline";

  /** Subsets of the icon sets used by the app, generated at build time. */
  const collections: IconifyJSON[];
  export default collections;
}
