import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();

    console.log('Checking for existing Squadz Pro product...');

    const existing = await stripe.products.search({
      query: "name:'Squadz Pro' AND active:'true'",
    });

    if (existing.data.length > 0) {
      console.log('Squadz Pro product already exists. Skipping creation.');
      console.log(`Existing product ID: ${existing.data[0].id}`);

      const prices = await stripe.prices.list({
        product: existing.data[0].id,
        active: true,
      });
      console.log('Existing prices:');
      for (const p of prices.data) {
        console.log(`  ${p.id} — $${(p.unit_amount ?? 0) / 100}/${(p.recurring as { interval: string } | null)?.interval}`);
      }
      return;
    }

    console.log('Creating Squadz Pro product...');
    const product = await stripe.products.create({
      name: 'Squadz Pro',
      description: 'Unlimited events, permanent photo vault, calendar sync, and custom invite codes.',
    });
    console.log(`Created product: ${product.name} (${product.id})`);

    const yearlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: 2000,
      currency: 'usd',
      recurring: { interval: 'year' },
    });
    console.log(`Created yearly price: $20.00/year (${yearlyPrice.id})`);

    console.log('\nSquadz Pro is ready!');
    console.log('Webhooks will sync this data to your database automatically.');
    console.log(`\nPrice ID to use in checkout: ${yearlyPrice.id}`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error creating products:', msg);
    process.exit(1);
  }
}

createProducts();
