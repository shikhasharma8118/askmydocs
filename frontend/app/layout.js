import "./globals.css";

export const metadata = {
  title: "Frontend",
  description: "Simple dark page",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
