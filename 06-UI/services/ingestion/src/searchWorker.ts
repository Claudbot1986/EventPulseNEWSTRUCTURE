import { createWorker } from './queue';

interface SearchSyncJob {
  event_id: string;
  action: 'upsert' | 'delete';
}

export function startSearchWorker(): void {
  const worker = createWorker(async (job) => {
    const { event_id, action } = job.data as SearchSyncJob;

    if (action === 'delete') {
      // Lazy import to avoid circular dependency
      const { deleteEvent } = await import('./search');
      await deleteEvent(event_id);
      return;
    }

    // Fetch full event from Supabase and upsert to Meilisearch
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: event, error } = await supabase
      .from('events')
      .select(`
        id,
        title_en,
        title_sv,
        description_en,
        description_sv,
        start_time,
        venues (name, city),
        event_categories (categories (slug))
      `)
      .eq('id', event_id)
      .single();

    if (error || !event) {
      console.error(`[search-worker] Failed to fetch event ${event_id}:`, error?.message);
      return;
    }

    const { upsertEvent } = await import('./search');

    await upsertEvent({
      id: event.id,
      title: event.title_en ?? event.title_sv ?? '',
      description: event.description_en ?? event.description_sv ?? null,
      start_time: event.start_time,
      venue_name: event.venues?.name ?? null,
      city: event.venues?.city ?? 'Stockholm',
      categories: event.event_categories?.map(
        (ec: { categories: { slug: string } }) => ec.categories.slug
      ) ?? [],
    });
  });


  worker.on('failed', (job, err) => {
    console.error(`[search-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[search-worker] Worker started');
}
