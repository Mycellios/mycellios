### Security

- Desktop's PC command executor now accepts connections only from this computer. Before, other
  devices on the same network could reach it, although they still needed its private key.
  Installations that still use the older Docker setup keep the previous behaviour.
- The local Desktop server rejects requests addressed to any name other than this computer, which
  blocks web pages that try to reach it through DNS rebinding.
- Account actions refuse requests that the browser marks as coming from another site, in addition
  to the existing cookie protection.
