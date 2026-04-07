import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  const stripe = await getUncachableStripeClient();

  console.log('Creating SportsMVP products in Stripe...');

  // ─── MVP Plan ────────────────────────────────────────────────
  const existingMvp = await stripe.products.search({ query: "name:'SportsMVP - MVP' AND active:'true'" });

  let mvpProduct: Stripe.Product;
  if (existingMvp.data.length > 0) {
    mvpProduct = existingMvp.data[0];
    console.log(`MVP product already exists: ${mvpProduct.id}`);
  } else {
    mvpProduct = await stripe.products.create({
      name: 'SportsMVP - MVP',
      description: 'Unlimited picks across all tiers, Parlay Builder, and Bet Tracker with Kelly calculator.',
      metadata: { tier: 'mvp' },
    });
    console.log(`Created MVP product: ${mvpProduct.id}`);

    await stripe.prices.create({
      product: mvpProduct.id,
      unit_amount: 1999,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { tier: 'mvp', interval_label: 'monthly' },
    });
    console.log('Created MVP monthly price: $19.99/mo');

    await stripe.prices.create({
      product: mvpProduct.id,
      unit_amount: 14900,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: { tier: 'mvp', interval_label: 'yearly' },
    });
    console.log('Created MVP yearly price: $149/yr');
  }

  // ─── MVP Pro Plan ─────────────────────────────────────────────
  const existingPro = await stripe.products.search({ query: "name:'SportsMVP - MVP Pro' AND active:'true'" });

  let proProduct: Stripe.Product;
  if (existingPro.data.length > 0) {
    proProduct = existingPro.data[0];
    console.log(`MVP Pro product already exists: ${proProduct.id}`);
  } else {
    proProduct = await stripe.products.create({
      name: 'SportsMVP - MVP Pro',
      description: 'Everything in MVP plus 5 and 6-leg parlays, priority model updates, and early access to new features.',
      metadata: { tier: 'mvp_pro' },
    });
    console.log(`Created MVP Pro product: ${proProduct.id}`);

    await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 3999,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { tier: 'mvp_pro', interval_label: 'monthly' },
    });
    console.log('Created MVP Pro monthly price: $39.99/mo');

    await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 29900,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: { tier: 'mvp_pro', interval_label: 'yearly' },
    });
    console.log('Created MVP Pro yearly price: $299/yr');
  }

  console.log('\nDone! Products created in Stripe. Webhooks will sync them to the database.');
  console.log('\nProduct IDs:');
  console.log(`  MVP:     ${mvpProduct.id}`);
  console.log(`  MVP Pro: ${proProduct.id}`);
}

createProducts().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
