import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "FraldaCerta — encontre o melhor custo por fralda",
  description: "Compare ofertas de fraldas por tamanho, marca e tipo, com preço por unidade e localização."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={manrope.className}>{children}</body></html>;
}
