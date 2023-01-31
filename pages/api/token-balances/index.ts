import { Alchemy, Network, TokenBalance, TokenBalancesResponse } from "alchemy-sdk";
import { NextApiRequest, NextApiResponse } from "next";

import {
  BIT_CONTRACT_ADDRESS,
  BIT_BURN_ADDRESS,
  BITDAO_TREASURY_ADDRESS,
  BITDAO_LP_WALLET_ADDRESS,
  BIT_LOCKED_ADDRESSES
} from "config/general";

import { BigNumber, Contract } from "ethers";
import { formatUnits } from "ethers/lib/utils";

const CACHE_TIME = 1800;
const alchemySettings = {
  apiKey: "", // Replace with your Alchemy API Key.
  network: Network.ETH_MAINNET, // Replace with your network.
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const alchemyApi = req.query.alchemyApi;
    if (!alchemyApi) {
      return res.json({
        success: false,
        statusCode: 500,
        message: "alchemyApi not provided",
      });
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    if (req.method == "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Methods",
        "PUT, POST, PATCH, DELETE, GET"
      );
      return res.status(200).json({});
    }

    alchemySettings.apiKey = String(req.query.alchemyApi);

    const alchemy = new Alchemy(alchemySettings);

    const getTotalSupply = async () => {
      // Example reading from a contract directly...
      const provider = await alchemy.config.getProvider();

      const abi = [
        "function totalSupply() view returns (uint256)",
      ];
      
      const erc20 = new Contract(BIT_CONTRACT_ADDRESS, abi, provider);

      return formatUnits(await erc20.totalSupply(), 18).toString();
    };

    const getCirculatingSupply = (
      totalSupply: string,
      bitBalancesData: TokenBalancesResponse, 
      bitLPTokenBalancesData: TokenBalancesResponse, 
      bitBurnedBalancesData: TokenBalancesResponse,
      bitLockedBalanceData: TokenBalancesResponse[]
    ) => {
      // returns the actual balance held within the TokenBalancesResponse
      const getBalance = (balance: TokenBalancesResponse) => {
        return parseFloat(balance.tokenBalances[0].tokenBalance || "0")
      }

      // sum all balances in the list of locked addresses
      const bitTotalLocked = bitLockedBalanceData.reduce((total: number, balance: TokenBalancesResponse) => total + getBalance(balance), 0);

      // take any BIT not in the circulating supply away from totalSupply
      return `${parseFloat(totalSupply) - getBalance(bitBalancesData) - getBalance(bitLPTokenBalancesData) - getBalance(bitBurnedBalancesData) - bitTotalLocked}`;
    };

    const getBalances = async (address: string) => {
      const balances = await alchemy.core.getTokenBalances(address, [
        BIT_CONTRACT_ADDRESS,
      ]);

      // normalise each of the discovered balances
      balances.tokenBalances = balances.tokenBalances.map((balance: TokenBalance) => {
        // format to ordinary value (to BIT)
        balance.tokenBalance = formatUnits(
          BigNumber.from(balance.tokenBalance),
          18
        ).toString()
  
        return balance;
      });

      return balances;
    };

    // get all async calls in parallel
    const [
      bitTotalSupply, 
      bitBalancesData, 
      bitLPTokenBalancesData, 
      bitBurnedBalancesData,
      bitLockedBalanceData
    ] = await Promise.all([
      getTotalSupply(),
      getBalances(BITDAO_TREASURY_ADDRESS),
      getBalances(BITDAO_LP_WALLET_ADDRESS),
      getBalances(BIT_BURN_ADDRESS),
      // get balance from each of the locked addresses (as a seperate await stack so we can map & reduce these)
      Promise.all(
        BIT_LOCKED_ADDRESSES.map(async (address) => getBalances(address))
      )
    ]);

    // construct results
    const results = {
      bitTotalSupply,
      bitBalancesData,
      bitLPTokenBalancesData,
      bitBurnedBalancesData,
      bitLockedBalanceData,
      bitCirculatingSupply: getCirculatingSupply(bitTotalSupply, bitBalancesData, bitLPTokenBalancesData, bitBurnedBalancesData, bitLockedBalanceData),
    };

    res.setHeader(
      "Cache-Control",
      `s-maxage=${CACHE_TIME}, stale-while-revalidate=${2 * CACHE_TIME}`
    );
    res.json({
      success: true,
      statusCode: 200,
      results: results,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, statusCode: 500, message: error?.message });
  }
};

export default handler;
