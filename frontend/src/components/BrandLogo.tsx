import baseLogo from "../assets/brand/base.svg";
import lightLogo from "../assets/brand/lightversion.svg";
import darkLogo from "../assets/brand/darkversion.svg";
import blackLogo from "../assets/brand/allblack.svg";
import whiteLogo from "../assets/brand/allwhite.svg";

const VARIANT_SRC = {
  base: baseLogo,
  light: lightLogo,
  dark: darkLogo,
  black: blackLogo,
  white: whiteLogo,
} as const;

export type BrandLogoVariant = keyof typeof VARIANT_SRC;

type BrandLogoProps = {
  variant?: BrandLogoVariant;
  className?: string;
  alt?: string;
};

export function BrandLogo({
  variant = "base",
  className = "h-8 w-auto",
  alt = "ASTRA",
}: BrandLogoProps) {
  return <img src={VARIANT_SRC[variant]} alt={alt} className={className} draggable={false} />;
}
