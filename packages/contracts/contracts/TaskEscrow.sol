// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITaskEscrow} from "./ITaskEscrow.sol";

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title TaskEscrow: verification-gated escrow for agent tasks.
/// @notice The contract never reruns validation. It accepts only the authorized validator settlement and stores the
///         commitment (`resultHash` = keccak256 of the canonical validation receipt) next to the task, so anyone can
///         re-hash the off-chain receipt and compare. A task settles exactly once.
contract TaskEscrow is ITaskEscrow {
    uint256 public constant VERIFY_GRACE = 30 minutes;

    address public immutable override token;
    address public override validator;
    address public owner;
    uint256 public override taskCount;

    mapping(uint256 => Task) private _tasks;
    uint256 private _lock = 1;

    error NotValidator();
    error NotOwner();
    error BadStatus(Status have);
    error NotSpecialist();
    error DeadlinePassed();
    error TooEarly();
    error NotClient();
    error ZeroValue();
    error TransferFailed();
    error Reentrancy();

    event ValidatorChanged(address indexed validator);

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address token_, address validator_) {
        token = token_;
        validator = validator_;
        owner = msg.sender;
    }

    function setValidator(address validator_) external {
        if (msg.sender != owner) revert NotOwner();
        validator = validator_;
        emit ValidatorChanged(validator_);
    }

    function createTask(
        uint256 bounty,
        uint64 deadline,
        address specialist,
        bytes32 specHash,
        bytes32 testsHash,
        string calldata specURI
    ) external nonReentrant returns (uint256 taskId) {
        if (bounty == 0 || deadline <= block.timestamp || specHash == bytes32(0)) revert ZeroValue();
        taskId = ++taskCount;
        _tasks[taskId] = Task({
            client: msg.sender,
            specialist: specialist,
            bounty: bounty,
            deadline: deadline,
            specHash: specHash,
            testsHash: testsHash,
            patchHash: bytes32(0),
            resultHash: bytes32(0),
            status: Status.Open
        });
        _pull(msg.sender, bounty);
        emit TaskCreated(taskId, msg.sender, specialist, bounty, deadline, specHash, testsHash, specURI);
    }

    function acceptTask(uint256 taskId) external {
        Task storage t = _tasks[taskId];
        if (t.status != Status.Open) revert BadStatus(t.status);
        if (block.timestamp > t.deadline) revert DeadlinePassed();
        if (t.specialist != address(0)) {
            if (msg.sender != t.specialist) revert NotSpecialist();
        } else {
            t.specialist = msg.sender;
        }
        t.status = Status.Accepted;
        emit TaskAccepted(taskId, msg.sender);
    }

    function submitResult(uint256 taskId, bytes32 patchHash, string calldata patchURI) external {
        Task storage t = _tasks[taskId];
        if (t.status != Status.Accepted) revert BadStatus(t.status);
        if (msg.sender != t.specialist) revert NotSpecialist();
        if (block.timestamp > t.deadline) revert DeadlinePassed();
        if (patchHash == bytes32(0)) revert ZeroValue();
        t.patchHash = patchHash;
        t.status = Status.Submitted;
        emit ResultSubmitted(taskId, msg.sender, patchHash, patchURI);
    }

    function settle(uint256 taskId, bool passed, bytes32 resultHash, string calldata resultURI)
        external
        nonReentrant
    {
        if (msg.sender != validator) revert NotValidator();
        Task storage t = _tasks[taskId];
        if (t.status != Status.Submitted) revert BadStatus(t.status);
        if (resultHash == bytes32(0)) revert ZeroValue();
        t.resultHash = resultHash;
        address paidTo = passed ? t.specialist : t.client;
        t.status = passed ? Status.Passed : Status.Failed;
        _push(paidTo, t.bounty);
        emit TaskSettled(taskId, passed, paidTo, t.bounty, resultHash, resultURI);
    }

    function refund(uint256 taskId) external nonReentrant {
        Task storage t = _tasks[taskId];
        if (msg.sender != t.client) revert NotClient();
        Status s = t.status;
        if (s == Status.Open || s == Status.Accepted) {
            if (block.timestamp <= t.deadline) revert TooEarly();
        } else if (s == Status.Submitted) {
            if (block.timestamp <= uint256(t.deadline) + VERIFY_GRACE) revert TooEarly();
        } else {
            revert BadStatus(s);
        }
        t.status = Status.Refunded;
        _push(t.client, t.bounty);
        emit TaskRefunded(taskId, t.client, t.bounty);
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    function _pull(address from, uint256 amount) private {
        (bool ok, bytes memory ret) =
            token.call(abi.encodeCall(IERC20Minimal.transferFrom, (from, address(this), amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
