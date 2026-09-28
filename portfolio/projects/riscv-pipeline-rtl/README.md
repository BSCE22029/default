# 5-Stage Pipelined RV32I Core

A classic 5-stage pipeline (IF → ID → EX → MEM → WB) implementing a subset of
RV32I: `ADD SUB AND OR XOR SLT ADDI LW SW BEQ`.

## Hazard handling

- **Data hazards (RAW)** — resolved by forwarding from the EX/MEM and
  MEM/WB pipeline registers back into the EX-stage ALU inputs
  (`forward_unit`), so back-to-back dependent ALU instructions run at
  full throughput with no stall.
- **Load-use hazard** — a value loaded by `LW` isn't available until the
  MEM stage completes, so it can't be forwarded in time to the very next
  instruction. `hazard_unit` detects this and stalls the pipeline for one
  cycle (freezes PC + IF/ID, inserts a bubble into ID/EX).
- **Control hazard** — `BEQ` is resolved in the ID stage (1-cycle branch
  penalty). When taken, the instruction fetched into IF/ID during the
  branch's ID cycle is squashed.

## Files

- `riscv_pipeline.v` — the core RTL (ALU, register file, control unit,
  hazard unit, forwarding unit, and the pipelined datapath).
- `tb_riscv_pipeline.v` — testbench; loads a hex program and prints the
  final register file.
- `prog_a_forwarding.hex` — back-to-back dependent ADDs (forwarding, no stall).
- `prog_b_loaduse.hex` — LW immediately followed by a dependent ADD (stall).
- `prog_c_branch.hex` — BEQ that's taken, squashing the next instruction.
- `prog_d_ideal.hex` — five independent ADDIs (ideal 1 IPC, no hazards).

## Running it

```
iverilog -o sim -D PROGRAM=\"prog_a_forwarding.hex\" riscv_pipeline.v tb_riscv_pipeline.v
vvp sim
```

Swap the `PROGRAM` define to run any of the other three test programs.

## Verification

Before writing the RTL, every instruction encoding above was generated and
cross-checked against an independent Python ISA-level simulator
(architectural execution, no pipelining) to confirm the expected final
register state:

| Program | Expected final registers |
|---|---|
| A (forwarding) | x1=5, x2=10, x3=15, x4=10 |
| B (load-use)   | x1=20, x2=20, x3=40 |
| C (branch)     | x1=1, x2=1, x3=0 (squashed), x4=42 |
| D (ideal)      | x1=1, x2=2, x3=3, x4=4, x5=5 |

The pipeline doesn't change architectural results, only timing — so a
correct implementation must reproduce this exact final state regardless of
how many stalls/forwards/flushes it took to get there.
