export function buildAutoAvatarUrl(user) {
  const seedSource =
    user?.email ||
    user?.firebase_uid ||
    user?.id ||
    user?.display_name ||
    "askmydocs-user";
  const seed = encodeURIComponent(String(seedSource).trim().toLowerCase());
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`;
}

export function withAutoAvatar(user) {
  if (!user || typeof user !== "object") {
    return user;
  }
  if (typeof user.avatar_url === "string" && user.avatar_url.trim()) {
    return user;
  }
  return { ...user, avatar_url: buildAutoAvatarUrl(user) };
}
