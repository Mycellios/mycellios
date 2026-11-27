### Fixed

- Micos no longer fail with "This model's context window is too small" when two connections enable the same model: a Mycellios connection whose live catalog stopped serving a model no longer takes precedence over the connection that actually runs it.
- A slow Mycellios catalog read keeps the last known model window instead of shrinking every Mycellios model to the connection default, which made turns on Mycellios Free fail.
- The model picker hides Mycellios network models whose window is too small for a Mico, such as the decision model, and shows Mycellios Free first among the free models.
- An expired or already used sign-in link now starts a fresh sign-in by itself; a connection problem says so instead of claiming the link expired.
