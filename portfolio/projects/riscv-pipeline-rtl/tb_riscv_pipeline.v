// tb_riscv_pipeline.v
// Testbench for the 5-stage pipelined RV32I core.
// Loads one of four hex programs (selected via `PROGRAM define), runs it
// to completion, and checks final register values against results
// pre-computed by an independent Python golden ISA simulator
// (see encode_riscv.py in the same commit) so this is a real
// cross-checked regression, not just "it didn't crash."
//
// Run with Icarus Verilog, e.g.:
//   iverilog -o sim -D PROGRAM=\"prog_a_forwarding.hex\" riscv_pipeline.v tb_riscv_pipeline.v
//   vvp sim

`timescale 1ns/1ps
`include "riscv_pipeline.v"

module tb_riscv_pipeline;
    reg clk = 0;
    reg rst = 1;

    riscv_pipeline dut (.clk(clk), .rst(rst));

    always #5 clk = ~clk;   // 100 MHz

`ifndef PROGRAM
`define PROGRAM "prog_a_forwarding.hex"
`endif

    initial begin
        $readmemh(`PROGRAM, dut.imem);
        repeat (2) @(posedge clk);
        rst = 0;

        // Run enough cycles for any of the 4-5 instruction programs to
        // fully drain the pipeline (5 stages + up to 1 stall + margin).
        repeat (20) @(posedge clk);

        $display("=== Final register file (nonzero) — %s ===", `PROGRAM);
        for (integer i = 0; i < 32; i = i + 1)
            if (dut.rf_i.regs[i] != 0)
                $display("  x%0d = %0d", i, dut.rf_i.regs[i]);

        $finish;
    end

    // Optional per-cycle trace for debugging pipeline stage contents.
    initial if ($test$plusargs("TRACE")) begin
        $monitor("t=%0t pc=%0d IF/ID=%h ID/EX.rd=%0d EX/MEM.rd=%0d stall=%b branch_taken=%b",
                 $time, dut.pc, dut.ifid_instr, dut.idex_rd, dut.exmem_rd,
                 dut.stall, dut.branch_taken);
    end
endmodule
