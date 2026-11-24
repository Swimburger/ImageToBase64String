import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "image-to-base64",
    compatibilityDate: "2026-11-23",
    domains: ["img2base64.swimburger.net"],
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: {
        enabled: true,
        headSamplingRate: 1,
      },
      traces: {
        enabled: true,
        headSamplingRate: 0.01,
      },
    },
  },
});

