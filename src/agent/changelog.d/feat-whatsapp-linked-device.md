### Self-host upgrade notes

- The WhatsApp linked-device connector stays off until the API runs with
  `MYCELLIOS_WHATSAPP_DEVICE_ENABLED=true`. Apply the database migrations first.
  Desktop release builds do not include the WhatsApp runtime yet, so linking a number
  is not available in the published app.
