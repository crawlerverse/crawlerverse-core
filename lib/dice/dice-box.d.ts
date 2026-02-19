/**
 * Type declarations for @3d-dice/dice-box
 * @see https://github.com/3d-dice/dice-box
 */
declare module '@3d-dice/dice-box' {
  interface DiceBoxOptions {
    assetPath?: string;
    gravity?: number;
    spinForce?: number;
    throwForce?: number;
    startingHeight?: number;
    settleTimeout?: number;
    delay?: number;
    lightIntensity?: number;
    enableShadows?: boolean;
    shadowTransparency?: number;
    scale?: number;
    theme?: string;
    themeColor?: string;
    foreground?: string;
    background?: string;
    material?: string;
  }

  interface DieResult {
    value: number;
    type: string;
  }

  class DiceBox {
    constructor(selector: string, options?: DiceBoxOptions);
    init(): Promise<void>;
    roll(notation: string | string[]): Promise<DieResult[]>;
    clear(): void;
    updateConfig(config: Partial<DiceBoxOptions>): void;
    onRollComplete(callback: (results: DieResult[]) => void): void;
  }

  export default DiceBox;
}
