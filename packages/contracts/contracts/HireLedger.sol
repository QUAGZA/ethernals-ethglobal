// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HireLedger
/// @notice Public record of paid AI-agent hires. The counting rule lives here, so anyone can audit it:
///         a hire's rating becomes a vote only if the buyer is a verified person who is NOT the agent's
///         provider, the payment was not used before, and the rating is 1..5. One vote per person per agent.
///         score = (9 + sumVotes) / (3 + votes);  price = basePrice * (9 + sumVotes) / (3 * (3 + votes)).
/// @dev The verifier (the Ethernals backend in v1) attests that the payment settled on Hedera and computes
///      per-agent person hashes = HMAC(secret, personId || agentKey). The contract never sees person ids.
contract HireLedger {
    enum Reason {
        COUNTED,
        COUNTED_REPLACED_VOTE,
        SAME_PERSON,
        UNVERIFIED_BUYER,
        DUPLICATE_PAYMENT,
        NO_RATING,
        INVALID_RATING,
        UNKNOWN_AGENT
    }

    struct Agent {
        bytes32 providerKey;
        bytes32 providerPersonHash;
        uint256 basePrice;
        uint32 votes;
        uint32 sumVotes;
        uint32 hiresTotal;
        uint32 hiresCounted;
        bool exists;
    }

    struct HireInput {
        bytes32 agentKey; // namehash(ens name)
        bytes32 buyerPersonHash; // 0x0 = buyer not verified
        bytes32 paymentRef; // keccak256(normalized Hedera tx id)
        string paymentTxId; // for humans and explorers
        uint256 amountPaid; // atomic units (USDC: 6 decimals)
        uint8 rating; // 0 = no rating, 1..5
        bytes32 consentHash;
        bytes32 parentHireRef; // 0x0 unless this is a sub-hire
    }

    uint256 private constant PRIOR_SUM = 9; // three neutral votes of 3
    uint256 private constant PRIOR_COUNT = 3;
    uint256 private constant SCALE = 1e6;

    address public owner;
    address public verifier;
    uint256 public hireCount;

    mapping(bytes32 => Agent) private agents;
    mapping(bytes32 => mapping(bytes32 => uint8)) public lastVote;
    mapping(bytes32 => bool) public usedPayment;

    event AgentRegistered(bytes32 indexed agentKey, bytes32 indexed providerKey, uint256 basePrice);
    event VerifierChanged(address indexed previous, address indexed next);
    event HireRecorded(
        bytes32 indexed agentKey,
        uint256 indexed hireNo,
        bytes32 buyerPersonHash,
        string paymentTxId,
        uint256 amountPaid,
        uint8 rating,
        bool counted,
        Reason reason,
        bytes32 consentHash,
        bytes32 parentHireRef,
        uint256 newScoreX1e6,
        uint256 newPrice
    );

    error NotOwner();
    error NotVerifier();
    error AgentAlreadyRegistered();
    error InvalidBasePrice();
    error InvalidProvider();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    constructor(address verifier_) {
        owner = msg.sender;
        verifier = verifier_ == address(0) ? msg.sender : verifier_;
        emit VerifierChanged(address(0), verifier);
    }

    function setVerifier(address next) external onlyOwner {
        emit VerifierChanged(verifier, next);
        verifier = next;
    }

    function registerAgent(bytes32 agentKey, bytes32 providerKey, bytes32 providerPersonHash, uint256 basePrice)
        external
        onlyVerifier
    {
        if (agents[agentKey].exists) revert AgentAlreadyRegistered();
        if (basePrice == 0) revert InvalidBasePrice();
        if (providerPersonHash == bytes32(0)) revert InvalidProvider();
        agents[agentKey] = Agent({
            providerKey: providerKey,
            providerPersonHash: providerPersonHash,
            basePrice: basePrice,
            votes: 0,
            sumVotes: 0,
            hiresTotal: 0,
            hiresCounted: 0,
            exists: true
        });
        emit AgentRegistered(agentKey, providerKey, basePrice);
    }

    function recordHire(HireInput calldata h) external onlyVerifier returns (bool counted, Reason reason) {
        return _record(h);
    }

    function recordHires(HireInput[] calldata hs) external onlyVerifier {
        for (uint256 i = 0; i < hs.length; i++) {
            _record(hs[i]);
        }
    }

    function _record(HireInput calldata h) internal returns (bool counted, Reason reason) {
        uint256 hireNo = ++hireCount;
        Agent storage a = agents[h.agentKey];

        if (!a.exists) {
            reason = Reason.UNKNOWN_AGENT;
        } else {
            a.hiresTotal += 1;
            if (usedPayment[h.paymentRef]) {
                reason = Reason.DUPLICATE_PAYMENT;
            } else {
                usedPayment[h.paymentRef] = true;
                if (h.buyerPersonHash == bytes32(0)) {
                    reason = Reason.UNVERIFIED_BUYER;
                } else if (h.buyerPersonHash == a.providerPersonHash) {
                    reason = Reason.SAME_PERSON;
                } else if (h.rating == 0) {
                    reason = Reason.NO_RATING;
                } else if (h.rating > 5) {
                    reason = Reason.INVALID_RATING;
                } else {
                    uint8 previous = lastVote[h.agentKey][h.buyerPersonHash];
                    if (previous == 0) {
                        a.votes += 1;
                        a.sumVotes += h.rating;
                        reason = Reason.COUNTED;
                    } else {
                        a.sumVotes = a.sumVotes - previous + h.rating;
                        reason = Reason.COUNTED_REPLACED_VOTE;
                    }
                    lastVote[h.agentKey][h.buyerPersonHash] = h.rating;
                    a.hiresCounted += 1;
                    counted = true;
                }
            }
        }

        _emitRecorded(h, hireNo, counted, reason);
    }

    function _emitRecorded(HireInput calldata h, uint256 hireNo, bool counted, Reason reason) private {
        Agent storage a = agents[h.agentKey];
        emit HireRecorded(
            h.agentKey,
            hireNo,
            h.buyerPersonHash,
            h.paymentTxId,
            h.amountPaid,
            h.rating,
            counted,
            reason,
            h.consentHash,
            h.parentHireRef,
            a.exists ? _score(a) : 0,
            a.exists ? _price(a) : 0
        );
    }

    function _score(Agent storage a) private view returns (uint256) {
        return ((PRIOR_SUM + a.sumVotes) * SCALE) / (PRIOR_COUNT + a.votes);
    }

    function _price(Agent storage a) private view returns (uint256) {
        return (a.basePrice * (PRIOR_SUM + a.sumVotes)) / (3 * (PRIOR_COUNT + a.votes));
    }

    function isRegistered(bytes32 agentKey) external view returns (bool) {
        return agents[agentKey].exists;
    }

    function scoreOf(bytes32 agentKey) external view returns (uint256 scoreX1e6) {
        Agent storage a = agents[agentKey];
        if (!a.exists) return 0;
        return _score(a);
    }

    function priceOf(bytes32 agentKey) external view returns (uint256) {
        Agent storage a = agents[agentKey];
        if (!a.exists) return 0;
        return _price(a);
    }

    function statsOf(bytes32 agentKey)
        external
        view
        returns (
            uint32 votes,
            uint32 sumVotes,
            uint32 hiresTotal,
            uint32 hiresCounted,
            uint256 basePrice,
            bytes32 providerKey
        )
    {
        Agent storage a = agents[agentKey];
        return (a.votes, a.sumVotes, a.hiresTotal, a.hiresCounted, a.basePrice, a.providerKey);
    }
}
