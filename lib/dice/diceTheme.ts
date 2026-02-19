/**
 * Tron-style theme configuration for dice-box.
 * Dark faces with glowing cyan edges.
 */
export const tronDiceTheme = {
  theme: 'default',
  themeColor: '#00ffff', // Cyan glow (matches --glow-player)
  foreground: '#ffffff', // White numbers
  background: '#1a1a2e', // Dark charcoal faces
  material: 'glass',     // Slight transparency/glow effect
};

/**
 * dice-box configuration options.
 */
export const diceBoxConfig = {
  gravity: 1,           // Lighter for longer, more dramatic rolls
  spinForce: 5,         // Good tumble
  friction: 0.8,        // Somewhat slippery
  throwForce: 1,        // Lower throw to keep dice centered
  startingHeight: 8,    // Drop from above
  settleTimeout: 3000,  // Max 3s to settle
  linearDamping: 0.4,   // Slow down over time
  angularDamping: 0.4,  // Slow rotation over time
  delay: 10,            // Small delay between multi-dice
  lightIntensity: 1.2,
  enableShadows: true,
  shadowTransparency: 0.5,
  scale: 25,            // Large, prominent dice
};
