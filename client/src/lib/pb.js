import PocketBase from "pocketbase";

export const backendUrl = import.meta.env.PROD
    ? undefined
    : import.meta.env.VITE_PB_BASE_URL || undefined;

export const pb = new PocketBase(backendUrl);
