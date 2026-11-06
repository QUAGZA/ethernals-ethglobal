// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITaskEscrow — FROZEN INTERFACE between the two build branches. Deployed on Ethereum Sepolia (chain 11155111).
/// @notice Verification-gated escrow for agent tasks (docs/proof-of-work/PLAN.md).
///         A client agent locks a bounty in tUSDC; a specialist agent accepts and submits a patch;
///         only the validator (the sandbox verifier) can settle: PASS pays the specialist, FAIL refunds the client.
///         After the deadline, an unsettled task can be refunded by the client.
/// @dev Dev A implements `TaskEscrow is ITaskEscrow` (the compiler enforces these signatures).
///      Dev B codes against the ABI exported from THIS file (packages/shared/src/task-escrow-abi.ts).
///      Do not change this file on a feature branch: changes go to main in a tiny PR both devs agree on.
interface ITaskEscrow {
    enum Status {
        None, // 0 — task id does not exist
        Open, // 1 — bounty locked, waiting for a specialist
        Accepted, // 2 — a specialist accepted
        Submitted, // 3 — the specialist submitted a patch; waiting for the validator
        Passed, // 4 — validator said PASS; bounty paid to the specialist
        Failed, // 5 — validator said FAIL; bounty refunded to the client
        Refunded // 6 — deadline passed without settlement; client took the bounty back
    }

    struct Task {
        address client; // client agent EVM address (paid the bounty)
        address specialist; // required specialist (set at create) or the one who accepted (open tasks)
        uint256 bounty; // tUSDC atomic units (6 decimals)
        uint64 deadline; // unix seconds; refund allowed after this if not settled
        bytes32 specHash; // keccak256 of the canonical public task spec JSON
        bytes32 testsHash; // keccak256 of the canonical hidden-tests bundle held by the verifier
        bytes32 patchHash; // keccak256 of the submitted patch text
        bytes32 resultHash; // keccak256 of the canonical verification result JSON
        Status status;
    }

    event TaskCreated(
        uint256 indexed taskId,
        address indexed client,
        address indexed specialist, // address(0) = open to any specialist
        uint256 bounty,
        uint64 deadline,
        bytes32 specHash,
        bytes32 testsHash,
        string specURI
    );
    event TaskAccepted(uint256 indexed taskId, address indexed specialist);
    event ResultSubmitted(uint256 indexed taskId, address indexed specialist, bytes32 patchHash, string patchURI);
    event TaskSettled(
        uint256 indexed taskId,
        bool passed,
        address indexed paidTo, // specialist on PASS, client on FAIL
        uint256 amount,
        bytes32 resultHash,
        string resultURI
    );
    event TaskRefunded(uint256 indexed taskId, address indexed client, uint256 amount);

    /// @notice The ERC-20 used for bounties (tUSDC on Ethereum Sepolia).
    function token() external view returns (address);

    /// @notice The only address allowed to call settle() (the sandbox verifier's key).
    function validator() external view returns (address);

    function taskCount() external view returns (uint256);

    /// @notice Pulls `bounty` tUSDC from msg.sender (needs prior approve) and opens a task. In production the caller is a
    ///         Namera-governed smart account, so its session-key policy (allowed contracts, token allowance, rate limit,
    ///         expiry) decides whether this call can happen at all.
    /// @param specialist address(0) for an open task, or the only specialist allowed to accept.
    function createTask(
        uint256 bounty,
        uint64 deadline,
        address specialist,
        bytes32 specHash,
        bytes32 testsHash,
        string calldata specURI
    ) external returns (uint256 taskId);

    /// @notice Open -> Accepted. Reverts if the task names a different specialist or the deadline passed.
    function acceptTask(uint256 taskId) external;

    /// @notice Accepted -> Submitted. Only the accepted specialist, before the deadline.
    function submitResult(uint256 taskId, bytes32 patchHash, string calldata patchURI) external;

    /// @notice Submitted -> Passed (pay specialist) or Failed (refund client). Only the validator.
    function settle(uint256 taskId, bool passed, bytes32 resultHash, string calldata resultURI) external;

    /// @notice Open/Accepted/Submitted -> Refunded after the deadline. Only the client.
    function refund(uint256 taskId) external;

    function getTask(uint256 taskId) external view returns (Task memory);
}
