import "./globals.css";

export const metadata = {
  title: "AskMyDocs",
  description: "Ask questions from your documents with AI.",
  icons: {
    icon: "/logo_of_app.png",
    shortcut: "/logo_of_app.png",
    apple: "/logo_of_app.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
