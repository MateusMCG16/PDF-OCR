import SiteHeader from '../components/SiteHeader'
import heroImage from '../assets/hero.png'
import { landingFeatures, landingSteps } from '../data/landing'
import './LandingPage.css'

function LandingPage() {
  return (
    <div className="landing-page">
      <SiteHeader />

      <main>
        <section className="landing-hero" id="inicio" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="hero-kicker">OCR para PDFs de livros</p>
            <h1 id="hero-title">Va direto para a pagina impressa.</h1>
            <p>
              Mapeie a numeracao do livro com a posicao real no arquivo e pare
              de contar capa, sumario e prefacio.
            </p>
            <div className="hero-actions">
              <a className="primary-link" href="#app">
                Abrir app
              </a>
              <a className="secondary-link" href="#como-funciona">
                Ver fluxo
              </a>
            </div>
          </div>
          <img
            className="hero-image"
            src={heroImage}
            alt="Scanner minimalista lendo uma pagina"
          />
        </section>

        <section className="content-section" id="problema" aria-labelledby="problem-title">
          <div className="section-copy">
            <p className="section-kicker">Problema</p>
            <h2 id="problem-title">O numero impresso raramente bate com o PDF.</h2>
            <p>
              A ferramenta le a area da numeracao, cria um mapa simples e leva
              voce para a pagina certa dentro do arquivo.
            </p>
          </div>

          <div className="feature-list" aria-label="Recursos principais">
            {landingFeatures.map((feature) => (
              <article className="feature-row" key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="workflow-section" id="como-funciona" aria-labelledby="flow-title">
          <div className="section-copy">
            <p className="section-kicker">Como funciona</p>
            <h2 id="flow-title">Um fluxo curto para chegar na pagina certa.</h2>
          </div>

          <ol className="workflow-list">
            {landingSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="roadmap-section" id="roadmap" aria-labelledby="roadmap-title">
          <div>
            <p className="section-kicker">MVP</p>
            <h2 id="roadmap-title">Comeca pequeno, resolve o essencial.</h2>
          </div>
          <p>
            Um PDF por vez, OCR na regiao marcada e busca pelo numero impresso.
            Sem cadastro, sem painel pesado, sem passos extras.
          </p>
          <a className="primary-link" href="#app">
            Comecar
          </a>
        </section>
      </main>
    </div>
  )
}

export default LandingPage
