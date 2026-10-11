// Avatarer, man kan vælge på forsiden. Værten accepterer kun disse.
export const AVATARS = ['🦊', '🐻', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄', '🐙', '🐢', '🦉', '🐧', '🐳', '🌻', '⭐'];
export const BOT_AVATAR = '🤖';

export const validAvatar = (emoji) => (AVATARS.includes(emoji) ? emoji : null);
