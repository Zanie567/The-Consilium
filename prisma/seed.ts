import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding database...')

  // Create categories
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'news' },
      update: {},
      create: { name: 'News', slug: 'news' },
    }),
    prisma.category.upsert({
      where: { slug: 'opinion' },
      update: {},
      create: { name: 'Opinion', slug: 'opinion' },
    }),
    prisma.category.upsert({
      where: { slug: 'analysis' },
      update: {},
      create: { name: 'Analysis', slug: 'analysis' },
    }),
    prisma.category.upsert({
      where: { slug: 'interviews' },
      update: {},
      create: { name: 'Interviews', slug: 'interviews' },
    }),
  ])

  console.log('Created categories:', categories.map((c: { name: string }) => c.name).join(', '))

  // Create admin user with hashed password
  const adminPassword = await bcrypt.hash('consilium2024', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@theconsilium.com' },
    update: { password: adminPassword },
    create: {
      name: 'The Consilium Admin',
      email: 'admin@theconsilium.com',
      password: adminPassword,
      role: 'ADMIN',
      bio: 'Editor-in-Chief of The Consilium.',
    },
  })

  console.log('Created admin:', admin.email)

  // Create writer
  const writerPassword = await bcrypt.hash('writer2024', 10)

  const writer = await prisma.user.upsert({
    where: { email: 'writer@theconsilium.com' },
    update: {},
    create: {
      name: 'Eleanor Hughes',
      email: 'writer@theconsilium.com',
      password: writerPassword,
      role: 'WRITER',
      bio: 'Eleanor Hughes is a third-year Economics student at the University of Edinburgh, specialising in macroeconomic policy and international finance.',
    },
  })

  console.log('Created writer:', writer.email)

  // Categories
  const [newsCategory, opinionCategory, analysisCategory] = categories

  // Sample article content (Tiptap JSON)
  const articleContent1 = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: "The Bank of England's recent decision to hold interest rates at 5.25% has sparked renewed debate about the trajectory of monetary policy in the United Kingdom. With inflation gradually retreating towards the 2% target, policymakers now face the delicate task of calibrating when to begin the long-anticipated cycle of rate cuts.",
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'The Inflation Picture' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Consumer price inflation fell to 3.4% in February 2024, its lowest level since September 2021, according to the Office for National Statistics. This marked a significant decline from the peak of 11.1% reached in October 2022, when energy price shocks and supply chain disruptions combined to produce the worst inflationary episode in four decades.',
          },
        ],
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '"The Monetary Policy Committee remains resolute in its commitment to restoring price stability, but the path forward requires careful judgement rather than mechanical rule-following."',
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Services inflation, which the MPC watches closely as an indicator of domestic inflationary pressures, remains stubbornly elevated at around 6%. This persistence reflects strong nominal wage growth and the lagged pass-through of earlier cost pressures into the prices of labour-intensive services.',
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Market Expectations' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Interest rate futures markets currently price in approximately two to three 25 basis point rate cuts by the end of 2024, with the first cut expected around August. This represents a significant downward revision from earlier in the year, when markets anticipated as many as six cuts. The recalibration reflects both the global recalibration of monetary policy expectations and the particular persistence of domestic inflationary pressures in the UK.',
          },
        ],
      },
    ],
  })

  const articleContent2 = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: "The question of whether artificial intelligence will primarily destroy jobs or create new ones has become one of the defining economic debates of our time. The answer, as with most important economic questions, is deeply uncertain and depends critically on the pace of technological change, the adaptability of workers, and the policy environment in which these transitions occur.",
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Historical Analogies and Their Limits' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Optimists frequently invoke the agricultural and industrial revolutions as evidence that technological disruption ultimately generates more employment than it destroys. The mechanisation of farming displaced millions of agricultural workers over the course of a century, yet living standards rose dramatically and new industries absorbed the displaced workers — albeit after periods of significant hardship.',
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: "The key difference this time, pessimists argue, is that AI threatens cognitive labour in a way that previous technologies did not. Agricultural mechanisation replaced muscle power; the assembly line replaced routine manual dexterity. But if AI can replicate complex reasoning, analysis, and even creativity, the range of tasks susceptible to automation expands dramatically.",
          },
        ],
      },
    ],
  })

  const articleContent3 = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: "House prices across most advanced economies have risen dramatically relative to incomes over the past three decades. The ratio of median house prices to median household income — a widely used measure of affordability — has roughly doubled in many OECD countries since the 1990s, with particularly dramatic deterioration in cities that have become hubs of knowledge-economy employment.",
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Causes of the Crisis' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'The causes are contested but the broad outlines are not. Restrictive planning regimes have constrained supply in areas of high demand. Low interest rates over the 2010s inflated asset prices broadly, including housing. Growing household incomes among high earners have bid up prices in desirable locations. And demographic trends — including declining household sizes — have increased demand for housing units independently of population growth.',
          },
        ],
      },
    ],
  })

  // Create articles
  const article1 = await prisma.article.upsert({
    where: { slug: 'bank-of-england-holds-rates-as-inflation-retreats' },
    update: {},
    create: {
      title: 'Bank of England Holds Rates as Inflation Retreats Toward Target',
      slug: 'bank-of-england-holds-rates-as-inflation-retreats',
      content: articleContent1,
      excerpt:
        'The MPC votes to maintain Bank Rate at 5.25%, signalling a cautious approach as inflation falls but services prices remain elevated.',
      categoryId: newsCategory.id,
      authorId: writer.id,
      status: 'PUBLISHED',
      publishedAt: new Date('2024-03-21'),
    },
  })

  const article2 = await prisma.article.upsert({
    where: { slug: 'ai-and-labour-markets-beyond-the-technopanic' },
    update: {},
    create: {
      title: 'AI and Labour Markets: Beyond the Technopanic',
      slug: 'ai-and-labour-markets-beyond-the-technopanic',
      content: articleContent2,
      excerpt:
        'The debate about artificial intelligence and employment is too important to be left to either starry-eyed optimists or catastrophists. A sober assessment of the evidence is overdue.',
      categoryId: opinionCategory.id,
      authorId: writer.id,
      status: 'PUBLISHED',
      publishedAt: new Date('2024-03-15'),
    },
  })

  const article3 = await prisma.article.upsert({
    where: { slug: 'housing-affordability-crisis-policy-responses' },
    update: {},
    create: {
      title: 'The Housing Affordability Crisis: Comparing Policy Responses Across the OECD',
      slug: 'housing-affordability-crisis-policy-responses',
      content: articleContent3,
      excerpt:
        "From Vienna's social housing model to Singapore's CPF scheme, different countries have taken strikingly different approaches to housing affordability. What can Britain learn from international experience?",
      categoryId: analysisCategory.id,
      authorId: admin.id,
      status: 'PUBLISHED',
      publishedAt: new Date('2024-03-10'),
    },
  })

  const article4 = await prisma.article.upsert({
    where: { slug: 'carbon-markets-fragmentation-climate-policy' },
    update: {},
    create: {
      title: 'Carbon Market Fragmentation and the Challenge of Global Climate Policy Coordination',
      slug: 'carbon-markets-fragmentation-climate-policy',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Draft content...' }],
          },
        ],
      }),
      excerpt:
        'An examination of the growing patchwork of carbon pricing mechanisms and their implications for climate ambition.',
      categoryId: analysisCategory.id,
      authorId: writer.id,
      status: 'DRAFT',
    },
  })

  console.log(
    'Created articles:',
    [article1, article2, article3, article4].map((a: { title: string }) => a.title).join(', ')
  )

  // Create team members
  const teamData = [
    {
      name: 'Alexander Escala',
      role: 'Editor-in-Chief',
      image: '/team/alexander-escala.png',
      bio: 'Economics student at the University of Edinburgh with a focus on development economics and structural transformation.',
      order: 1,
    },
    {
      name: 'Annika Sarawgi',
      role: 'Senior Editor',
      image: '/team/annika-sarawgi.png',
      bio: 'Senior Editor at The Consilium, coordinating editorial strategy and content development.',
      order: 2,
    },
    {
      name: 'Sam Hunt',
      role: 'Junior Editor',
      image: '/team/sam-hunt.png',
      bio: 'Junior Editor supporting content creation and editorial processes.',
      order: 3,
    },
    {
      name: 'Zara Spendiff',
      role: 'Writer',
      image: '/team/zara-spendiff.png',
      bio: 'Writer covering economics, policy, and current affairs.',
      order: 4,
    },
    {
      name: 'Gurmehar Kaur',
      role: 'Writer',
      image: '/team/gurmehar-kaur.png',
      bio: 'Writer contributing analysis and commentary on economic issues.',
      order: 5,
    },
    {
      name: 'Yaoqing Wang',
      role: 'Writer',
      bio: 'Writer exploring economic policy and international affairs.',
      order: 6,
    },
    {
      name: 'Catherine Toh',
      role: 'Writer',
      image: '/team/catherine-toh.png',
      bio: 'Writer focusing on economic analysis and commentary.',
      order: 7,
    },
  ]

  // Clear existing team members first
  await prisma.teamMember.deleteMany({})
  console.log('Cleared existing team members')

  // Create new team members
  for (const member of teamData) {
    await prisma.teamMember.create({ data: member })
  }

  console.log('Created team members:', teamData.map(m => m.name).join(', '))
  console.log('\nSeeding complete!')
  console.log('\nAdmin credentials:')
  console.log('  Email: admin@theconsilium.com')
  console.log('  Password: consilium2024')
  console.log('\nWriter credentials:')
  console.log('  Email: writer@theconsilium.com')
  console.log('  Password: writer2024')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
