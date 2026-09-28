// riscv_pipeline.v
// 5-stage pipelined RV32I core (IF -> ID -> EX -> MEM -> WB)
// Author: Muhammad Moiz Ahmad
//
// Supports: ADD, SUB, AND, OR, XOR, SLT (R-type)
//           ADDI (I-type), LW (load), SW (store), BEQ (branch)
//
// Hazard handling:
//   - Data hazards (RAW) resolved by forwarding from EX/MEM and MEM/WB
//     pipeline registers back into the EX-stage ALU inputs.
//   - Load-use hazard (value needed the cycle immediately after a LW)
//     cannot be forwarded in time, so the hazard detection unit stalls
//     the pipeline for one cycle (bubble inserted into ID/EX).
//   - Control hazard: BEQ is resolved in the ID stage (1-cycle branch
//     penalty). If taken, the instruction that was fetched into IF/ID
//     during the branch's ID cycle is squashed.

`timescale 1ns/1ps

// ───────────────────────── ALU ─────────────────────────
module alu (
    input  [31:0] a, b,
    input  [3:0]  op,        // 0=ADD 1=SUB 2=AND 3=OR 4=XOR 5=SLT
    output reg [31:0] result
);
    always @(*) begin
        case (op)
            4'd0: result = a + b;
            4'd1: result = a - b;
            4'd2: result = a & b;
            4'd3: result = a | b;
            4'd4: result = a ^ b;
            4'd5: result = ($signed(a) < $signed(b)) ? 32'd1 : 32'd0;
            default: result = 32'hxxxxxxxx;
        endcase
    end
endmodule

// ───────────────────────── Register File ─────────────────────────
// Synchronous write (WB stage), combinational read with same-cycle
// write-forwarding so a value written this cycle is visible to a
// read issued the same cycle (standard "write-first" regfile).
module regfile (
    input         clk,
    input         we,
    input  [4:0]  rs1, rs2, rd,
    input  [31:0] wdata,
    output [31:0] rdata1, rdata2
);
    reg [31:0] regs [0:31];
    integer i;
    initial for (i = 0; i < 32; i = i + 1) regs[i] = 32'b0;

    always @(posedge clk) begin
        if (we && rd != 5'd0) regs[rd] <= wdata;
    end

    assign rdata1 = (rs1 == 5'd0) ? 32'b0 :
                    (we && rd == rs1 && rd != 5'd0) ? wdata : regs[rs1];
    assign rdata2 = (rs2 == 5'd0) ? 32'b0 :
                    (we && rd == rs2 && rd != 5'd0) ? wdata : regs[rs2];
endmodule

// ───────────────────────── Control Unit ─────────────────────────
module control (
    input  [6:0] opcode,
    output reg   reg_write, mem_read, mem_write, mem_to_reg,
    output reg   alu_src,       // 0 = rs2, 1 = immediate
    output reg   branch,
    output reg [3:0] alu_op
);
    localparam OP_R      = 7'b0110011;
    localparam OP_IMM    = 7'b0010011; // ADDI
    localparam OP_LOAD   = 7'b0000011; // LW
    localparam OP_STORE  = 7'b0100011; // SW
    localparam OP_BRANCH = 7'b1100011; // BEQ

    always @(*) begin
        reg_write = 0; mem_read = 0; mem_write = 0; mem_to_reg = 0;
        alu_src = 0; branch = 0; alu_op = 4'd0;
        case (opcode)
            OP_R:      begin reg_write = 1; end                 // alu_op set from funct3/funct7 in decode
            OP_IMM:    begin reg_write = 1; alu_src = 1; alu_op = 4'd0; end
            OP_LOAD:   begin reg_write = 1; alu_src = 1; mem_read = 1; mem_to_reg = 1; alu_op = 4'd0; end
            OP_STORE:  begin alu_src = 1; mem_write = 1; alu_op = 4'd0; end
            OP_BRANCH: begin branch = 1; alu_op = 4'd1; end      // SUB, zero flag = equal
            default: ;
        endcase
    end
endmodule

// ───────────────────────── Hazard Detection Unit ─────────────────────────
// Stalls the pipeline (freezes PC + IF/ID, bubbles ID/EX) when the
// instruction in ID needs a register that the instruction ahead of it
// (currently in EX, i.e. ID/EX) is loading from memory.
module hazard_unit (
    input        idex_mem_read,
    input  [4:0] idex_rd,
    input  [4:0] ifid_rs1, ifid_rs2,
    output       stall
);
    assign stall = idex_mem_read &&
                   ((idex_rd == ifid_rs1) || (idex_rd == ifid_rs2)) &&
                   (idex_rd != 5'd0);
endmodule

// ───────────────────────── Forwarding Unit ─────────────────────────
// Resolves RAW hazards that DON'T require a stall by forwarding the
// not-yet-committed result from a later pipeline stage back into the
// EX-stage ALU inputs. EX/MEM (1 instruction ahead) has priority over
// MEM/WB (2 instructions ahead) since it holds the more recent value.
module forward_unit (
    input  [4:0] idex_rs1, idex_rs2,
    input  [4:0] exmem_rd, memwb_rd,
    input        exmem_reg_write, memwb_reg_write,
    output reg [1:0] forward_a, forward_b   // 0=regfile 1=EX/MEM 2=MEM/WB
);
    always @(*) begin
        forward_a = 2'd0;
        if (exmem_reg_write && exmem_rd != 5'd0 && exmem_rd == idex_rs1)
            forward_a = 2'd1;
        else if (memwb_reg_write && memwb_rd != 5'd0 && memwb_rd == idex_rs1)
            forward_a = 2'd2;

        forward_b = 2'd0;
        if (exmem_reg_write && exmem_rd != 5'd0 && exmem_rd == idex_rs2)
            forward_b = 2'd1;
        else if (memwb_reg_write && memwb_rd != 5'd0 && memwb_rd == idex_rs2)
            forward_b = 2'd2;
    end
endmodule

// ───────────────────────── Top-Level Pipeline ─────────────────────────
module riscv_pipeline #(
    parameter IMEM_WORDS = 64,
    parameter DMEM_WORDS = 64
)(
    input clk,
    input rst
);
    // ── Instruction memory (loaded externally via $readmemh in the testbench) ──
    reg [31:0] imem [0:IMEM_WORDS-1];
    reg [31:0] dmem [0:DMEM_WORDS-1];

    // ── PC ──
    reg [31:0] pc;
    wire [31:0] pc_next;
    wire stall, branch_taken;
    wire [31:0] branch_target;

    always @(posedge clk) begin
        if (rst) pc <= 32'b0;
        else if (!stall) pc <= pc_next;
    end
    assign pc_next = branch_taken ? branch_target : (pc + 32'd4);

    // ── IF stage ──
    wire [31:0] if_instr = imem[pc[31:2]];

    reg [31:0] ifid_pc, ifid_instr;
    reg        ifid_valid;
    always @(posedge clk) begin
        if (rst || (branch_taken)) begin
            ifid_instr <= 32'h00000013; // NOP (addi x0,x0,0) — squash on flush
            ifid_valid <= 1'b0;
        end else if (!stall) begin
            ifid_pc    <= pc;
            ifid_instr <= if_instr;
            ifid_valid <= 1'b1;
        end
        // if stalled, IF/ID holds its value (no else branch needed — implicit hold)
    end

    // ── ID stage ──
    wire [6:0] id_opcode = ifid_instr[6:0];
    wire [4:0] id_rd     = ifid_instr[11:7];
    wire [2:0] id_funct3 = ifid_instr[14:12];
    wire [4:0] id_rs1    = ifid_instr[19:15];
    wire [4:0] id_rs2    = ifid_instr[24:20];
    wire [6:0] id_funct7 = ifid_instr[31:25];

    wire [31:0] id_rdata1, id_rdata2;
    wire        id_reg_write, id_mem_read, id_mem_write, id_mem_to_reg, id_alu_src, id_branch;
    wire [3:0]  id_alu_op_ctrl;

    control ctrl_i (
        .opcode(id_opcode), .reg_write(id_reg_write), .mem_read(id_mem_read),
        .mem_write(id_mem_write), .mem_to_reg(id_mem_to_reg), .alu_src(id_alu_src),
        .branch(id_branch), .alu_op(id_alu_op_ctrl)
    );

    // Resolve the actual ALU operation for R-type using funct3/funct7
    reg [3:0] id_alu_op;
    always @(*) begin
        if (id_opcode == 7'b0110011) begin // R-type
            case ({id_funct7[5], id_funct3})
                4'b0000: id_alu_op = 4'd0; // ADD
                4'b1000: id_alu_op = 4'd1; // SUB
                4'b0111: id_alu_op = 4'd2; // AND
                4'b0110: id_alu_op = 4'd3; // OR
                4'b0100: id_alu_op = 4'd4; // XOR
                4'b0010: id_alu_op = 4'd5; // SLT
                default: id_alu_op = 4'd0;
            endcase
        end else begin
            id_alu_op = id_alu_op_ctrl;
        end
    end

    // Immediate generation (I/S/B types used here)
    reg [31:0] id_imm;
    always @(*) begin
        case (id_opcode)
            7'b0000011, 7'b0010011: // LOAD, ADDI (I-type)
                id_imm = {{20{ifid_instr[31]}}, ifid_instr[31:20]};
            7'b0100011: // SW (S-type)
                id_imm = {{20{ifid_instr[31]}}, ifid_instr[31:25], ifid_instr[11:7]};
            7'b1100011: // BEQ (B-type)
                id_imm = {{19{ifid_instr[31]}}, ifid_instr[31], ifid_instr[7],
                          ifid_instr[30:25], ifid_instr[11:8], 1'b0};
            default: id_imm = 32'b0;
        endcase
    end

    // WB signals forwarded back for regfile write-first read bypass
    wire        wb_reg_write;
    wire [4:0]  wb_rd;
    wire [31:0] wb_wdata;

    regfile rf_i (
        .clk(clk), .we(wb_reg_write), .rs1(id_rs1), .rs2(id_rs2), .rd(wb_rd),
        .wdata(wb_wdata), .rdata1(id_rdata1), .rdata2(id_rdata2)
    );

    // Branch resolved here in ID (1-cycle penalty design)
    assign branch_taken  = id_branch && ifid_valid && (id_rdata1 == id_rdata2);
    assign branch_target = ifid_pc + id_imm;

    // ── Hazard detection (uses ID/EX from *previous* cycle, declared below) ──
    wire        idex_mem_read_w;
    wire [4:0]  idex_rd_w;
    hazard_unit haz_i (
        .idex_mem_read(idex_mem_read_w), .idex_rd(idex_rd_w),
        .ifid_rs1(id_rs1), .ifid_rs2(id_rs2), .stall(stall)
    );

    // ── ID/EX pipeline register ──
    reg [31:0] idex_pc, idex_rdata1, idex_rdata2, idex_imm;
    reg [4:0]  idex_rs1, idex_rs2, idex_rd;
    reg [3:0]  idex_alu_op;
    reg        idex_alu_src, idex_reg_write, idex_mem_read, idex_mem_write, idex_mem_to_reg;

    always @(posedge clk) begin
        if (rst || stall || branch_taken) begin
            // Insert a bubble: all control signals that write state go to 0
            idex_reg_write  <= 1'b0;
            idex_mem_read   <= 1'b0;
            idex_mem_write  <= 1'b0;
            idex_mem_to_reg <= 1'b0;
            idex_rd         <= 5'd0;
        end else begin
            idex_pc         <= ifid_pc;
            idex_rdata1     <= id_rdata1;
            idex_rdata2     <= id_rdata2;
            idex_imm        <= id_imm;
            idex_rs1        <= id_rs1;
            idex_rs2        <= id_rs2;
            idex_rd         <= id_rd;
            idex_alu_op     <= id_alu_op;
            idex_alu_src    <= id_alu_src;
            idex_reg_write  <= id_reg_write;
            idex_mem_read   <= id_mem_read;
            idex_mem_write  <= id_mem_write;
            idex_mem_to_reg <= id_mem_to_reg;
        end
    end
    assign idex_mem_read_w = idex_mem_read;
    assign idex_rd_w       = idex_rd;

    // ── EX stage ──
    wire [1:0] forward_a, forward_b;
    wire [4:0] exmem_rd_w, memwb_rd_w;
    wire       exmem_reg_write_w, memwb_reg_write_w;

    forward_unit fwd_i (
        .idex_rs1(idex_rs1), .idex_rs2(idex_rs2),
        .exmem_rd(exmem_rd_w), .memwb_rd(memwb_rd_w),
        .exmem_reg_write(exmem_reg_write_w), .memwb_reg_write(memwb_reg_write_w),
        .forward_a(forward_a), .forward_b(forward_b)
    );

    wire [31:0] exmem_alu_result_w, memwb_result_w;

    reg [31:0] ex_fwd_a, ex_fwd_b;
    always @(*) begin
        case (forward_a)
            2'd1: ex_fwd_a = exmem_alu_result_w;
            2'd2: ex_fwd_a = memwb_result_w;
            default: ex_fwd_a = idex_rdata1;
        endcase
        case (forward_b)
            2'd1: ex_fwd_b = exmem_alu_result_w;
            2'd2: ex_fwd_b = memwb_result_w;
            default: ex_fwd_b = idex_rdata2;
        endcase
    end

    wire [31:0] alu_operand_b = idex_alu_src ? idex_imm : ex_fwd_b;
    wire [31:0] alu_result;

    alu alu_i (.a(ex_fwd_a), .b(alu_operand_b), .op(idex_alu_op), .result(alu_result));

    // ── EX/MEM pipeline register ──
    reg [31:0] exmem_alu_result, exmem_store_data;
    reg [4:0]  exmem_rd;
    reg        exmem_reg_write, exmem_mem_read, exmem_mem_write, exmem_mem_to_reg;

    always @(posedge clk) begin
        if (rst) begin
            exmem_reg_write <= 1'b0; exmem_mem_read <= 1'b0; exmem_mem_write <= 1'b0;
        end else begin
            exmem_alu_result <= alu_result;
            exmem_store_data <= ex_fwd_b;      // value being stored (SW), forwarded if needed
            exmem_rd         <= idex_rd;
            exmem_reg_write  <= idex_reg_write;
            exmem_mem_read   <= idex_mem_read;
            exmem_mem_write  <= idex_mem_write;
            exmem_mem_to_reg <= idex_mem_to_reg;
        end
    end
    assign exmem_alu_result_w = exmem_alu_result;
    assign exmem_rd_w         = exmem_rd;
    assign exmem_reg_write_w  = exmem_reg_write;

    // ── MEM stage ──
    wire [31:0] mem_rdata = dmem[exmem_alu_result[31:2]];
    always @(posedge clk) begin
        if (exmem_mem_write) dmem[exmem_alu_result[31:2]] <= exmem_store_data;
    end

    // ── MEM/WB pipeline register ──
    reg [31:0] memwb_alu_result, memwb_mem_rdata;
    reg [4:0]  memwb_rd;
    reg        memwb_reg_write, memwb_mem_to_reg;

    always @(posedge clk) begin
        if (rst) begin
            memwb_reg_write <= 1'b0;
        end else begin
            memwb_alu_result <= exmem_alu_result;
            memwb_mem_rdata  <= mem_rdata;
            memwb_rd         <= exmem_rd;
            memwb_reg_write  <= exmem_reg_write;
            memwb_mem_to_reg <= exmem_mem_to_reg;
        end
    end
    assign memwb_rd_w        = memwb_rd;
    assign memwb_reg_write_w = memwb_reg_write;
    assign memwb_result_w    = memwb_mem_to_reg ? memwb_mem_rdata : memwb_alu_result;

    // ── WB stage ──
    assign wb_reg_write = memwb_reg_write;
    assign wb_rd        = memwb_rd;
    assign wb_wdata      = memwb_mem_to_reg ? memwb_mem_rdata : memwb_alu_result;

endmodule
