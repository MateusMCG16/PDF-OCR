function SiteHeader() {
  return (
    <header className="site-header">
      <a className="site-brand" href="#inicio" aria-label="Ir para o inicio">
        <span className="site-brand-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M6 3h8l4 4v14H6z" />
            <path d="M14 3v5h4" />
            <path d="M8 13h8M8 17h5" />
          </svg>
        </span>
        <span>PDF OCR</span>
      </a>

      <nav className="site-nav" aria-label="Principal">
        <a href="#problema">Problema</a>
        <a href="#como-funciona">Fluxo</a>
        <a href="#app">Abrir app</a>
      </nav>
    </header>
  )
}

export default SiteHeader
