type FeatureCardProps = {
  title: string
  text: string
}

function FeatureCard({ title, text }: FeatureCardProps) {
  return (
    <article className="feature-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  )
}

export default FeatureCard
