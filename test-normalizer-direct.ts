import { processRawEvent } from "./04-Normalizer/normalizer.ts";
async function run() {
  const mockJob = {
    id: "test-aik",
    data: {
      title: "Test Event AIK",
      description: "Test desc",
      start_time: "2026-04-23T19:00:00.000Z",
      end_time: null,
      venue_name: "Råsta Park",
      venue_address: null,
      lat: 59.35,
      lng: 18.0,
      categories: ["sports"],
      is_free: false,
      price_min_sek: null,
      price_max_sek: null,
      ticket_url: null,
      image_url: null,
      source: "aik",
      source_id: "test-event-1",
      detected_language: null,
      raw_payload: {}
    }
  };
  try {
    await processRawEvent(mockJob);
    console.log("SUCCESS");
  } catch (e: any) {
    console.error("ERROR:", e.message);
  }
}
run();