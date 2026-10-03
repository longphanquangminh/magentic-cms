import './globals.css'
import './live-v2.css'
import type {Metadata} from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'MagenticCMS — rehearse the crowd before you post',
  description:
    'Hundreds of survey-grounded persona agents react to your draft, live, before real people do. Built on Sanity.',
}

const STUDIO = process.env.NEXT_PUBLIC_STUDIO_URL

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&family=Noto+Color+Emoji&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="topbar">
          <Link href="/" className="logo">
            <span className="logo-mark" aria-hidden="true" /> Magentic<span className="logo-cms">CMS</span>
          </Link>
          <nav>
            <Link href="/">Posts</Link>
            <Link href="/compose">+ Write a post</Link>
            {STUDIO && (
              <a href={STUDIO} target="_blank" rel="noopener noreferrer">
                Studio ↗︎
              </a>
            )}
            <a href="https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M" target="_blank" rel="noopener noreferrer">
              Personas: MatrAIx ↗︎
            </a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  )
}
