# Data attribution and scope

MagenticCMS uses a projected subset of sample records from:

- **MatrAIx2026 / MatrAIx_Persona_1M:** https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M
- **Dataset card and terms:** https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M/blob/main/README.md
- **Paper, MatrAIx: Simulating the World with 8.3 Billion Persona Agents:** https://arxiv.org/abs/2608.04205

## License boundary

The dataset card supplied with the build states **non-commercial research use only**, including subsets and derivatives. It distinguishes the dataset terms from the software license of the MatrAIx GitHub repository. Upstream source terms continue to apply, including attribution and other conditions.

A license applied to MagenticCMS source code must not be interpreted as relicensing MatrAIx records or their derivatives. This project does not claim rights to offer these data in a commercial product or paid hosted service. Whether a particular competition submission or later use satisfies all applicable terms has not been separately confirmed with the dataset owner.

For a public source repository, keep source attribution and projection scripts. Review the dataset and upstream terms before redistributing raw Parquet files or derived persona documents. Obtain appropriate permission before any use outside those terms.

## Interpretation and responsible use

The build uses a 379-record projected pool from a downloaded sample, including both human-grounded and synthetic records. Generated display handles are simulation aliases, not assertions of the identity of the source individuals. The UI must not impersonate or re-identify real people.

Human-grounded is not equivalent to verified. Attributes can contain extraction/mapping errors. The selected sample is not representative of a country or demographic group. Simulated outputs should not be treated as individual profiling, protected-group targeting guidance, or validated population measurements.

The dataset card includes responsible-use expectations and a revision/takedown policy. Downstream users should check for updates and comply with removals and applicable upstream terms.

## Fictional demonstration content

Saveo and Bolt Burgers in the seeded application are fictional demo brands for these scenarios. Their seeded past incidents, red lines, promotional claims, and test posts are synthetic test fixtures, not factual reports about real organisations. The generated reactions are model outputs, not survey responses collected for these posts.

No API keys, access tokens, real account passwords, or private user content belong in the public submission, screenshots, video or repository.
