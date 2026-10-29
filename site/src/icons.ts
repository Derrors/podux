import { addCollection } from "@iconify/react/offline";
import collections from "virtual:iconify-icons";

// Icons are bundled at build time (see iconifyOffline in vite.config.ts) and rendered
// with the offline Icon component, so nothing is fetched from api.iconify.design.
for (const collection of collections) {
  addCollection(collection);
}
